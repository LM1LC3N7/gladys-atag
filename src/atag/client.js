// -----------------------------------------------------------------------------
// The local HTTP interface of the Atag One (port 10000), ported from pyatag:
//   POST /pair      { pair_message: { account_auth, accounts } }   -> pair_reply
//   POST /retrieve  { retrieve_message: { account_auth, info } }   -> retrieve_reply
//   POST /update    { update_message: { account_auth, control } }  -> update_reply
// `account_auth.mac_address` identifies this client: the thermostat ties its
// authorization to it (confirmed once on its screen). One request at a time,
// at least one second apart (pyatag: the thermostat drops faster callers); a
// connection the thermostat closes is tried again (reads only: an update may
// have been applied, it is never sent twice). Plain HTTP: no TLS on this port.
// -----------------------------------------------------------------------------

import { CONTROL_KEYS, DHW_SETPOINT, MAX_BYTES, TIMEOUTS } from '../constants.js';
import { CODES, ThermostatError } from './errors.js';
import { httpPost } from './http.js';
import { isAuthorized, parseJson, parseReport, replyOf } from './parse.js';

/** Room a request needs before its deadline, or it is not sent at all. */
const MIN_SEND_MS = 300;
/** Tries of a read when the thermostat closes the connection (pyatag: 10). */
const READ_TRIES = 3;
/** What `retrieve` asks for (pyatag: report, control and configuration). */
const INFO = 71;
/** Our own identity, never that of an app. */
export const USER_AGENT = 'gladys-atag (+https://github.com/LM1LC3N7/gladys-atag)';

const notSent = (err) => {
  if (err && typeof err === 'object') err.notSent = true;
  return err;
};

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class ThermostatClient {
  /**
   * @param {object} options
   * @param {string} options.origin `http://host:port`
   * @param {string} options.mac the identity of this client (`AA-BB-CC-DD-EE-FF`)
   * @param {Function} [options.request] the HTTP transport (tests inject a fake thermostat)
   * @param {() => number} [options.monotonic]
   * @param {(ms: number) => Promise<void>} [options.sleep]
   */
  constructor({
    origin,
    mac,
    request = httpPost,
    monotonic,
    sleep = defaultSleep,
    timers = { setTimeout, clearTimeout },
  }) {
    this.timers = timers;
    this.origin = origin;
    this.mac = mac;
    this.request = request;
    this.monotonic = monotonic ?? (() => performance.now());
    this.sleep = sleep;
    this.closed = false;
    this.queue = Promise.resolve();
    this.lastCallAt = undefined;
  }

  close() {
    this.closed = true;
  }

  auth() {
    return { user_account: '', mac_address: this.mac };
  }

  /** Run `task` after every request already queued (one at a time). */
  serial(task, { deadline } = {}) {
    let started = false;
    let cancelled = false;
    const run = this.queue.then(() => {
      if (cancelled) {
        throw notSent(new ThermostatError(CODES.BUSY, 'Previous request still running'));
      }
      started = true;
      return task();
    });
    this.queue = run.catch(() => {});
    if (deadline === undefined) return run;
    // The wait in the queue is bounded too: past `deadline` - MIN_SEND_MS
    // without having started, the request is dropped (never sent late) and
    // the caller learns the true cause at once.
    let id;
    const limit = new Promise((_, reject) => {
      id = this.timers.setTimeout(
        () => {
          if (started) return;
          cancelled = true;
          reject(notSent(new ThermostatError(CODES.BUSY, 'Previous request still running')));
        },
        Math.max(0, deadline - MIN_SEND_MS - this.monotonic()),
      );
    });
    return Promise.race([run, limit]).finally(() => this.timers.clearTimeout(id));
  }

  /** The ms this request may take, from the caller's instant; throws when none is left. */
  budget(deadline, mono) {
    if (deadline === undefined) return TIMEOUTS.REQUEST;
    const remaining = deadline - mono;
    if (remaining < MIN_SEND_MS) {
      throw notSent(new ThermostatError(CODES.NO_TIME, 'No time left: request not sent'));
    }
    return Math.min(TIMEOUTS.REQUEST, remaining);
  }

  /**
   * One POST, after the spacing; resolves the `<path>_reply`, rejects a
   * ThermostatError. `deadline`: the whole exchange ends by then (a read of a
   * command). `sendDeadline`: the request must LEAVE by then, its answer may
   * come later, within the usual timeout (an update: never sent late, never
   * cut before the thermostat could answer).
   */
  async post(path, message, { deadline, sendDeadline, onSent } = {}) {
    if (this.closed) throw notSent(new ThermostatError(CODES.CLOSED, 'Client closed'));
    const limit = sendDeadline ?? deadline;
    const mono = this.monotonic();
    if (this.lastCallAt !== undefined) {
      const wait = this.lastCallAt + TIMEOUTS.SPACING - mono;
      if (wait > 0) {
        // The wait counts in the budget: a command never leaves late.
        if (limit !== undefined && limit - mono - wait < MIN_SEND_MS) {
          throw notSent(new ThermostatError(CODES.NO_TIME, 'No time left: request not sent'));
        }
        await this.sleep(wait);
      }
    }
    if (this.closed) throw notSent(new ThermostatError(CODES.CLOSED, 'Client closed'));
    const now = this.monotonic();
    const timeout = this.budget(deadline, now);
    let sendWithin;
    if (limit !== undefined) {
      sendWithin = limit - now;
      if (sendWithin < MIN_SEND_MS) {
        throw notSent(new ThermostatError(CODES.NO_TIME, 'No time left: request not sent'));
      }
    }
    this.lastCallAt = now;
    const response = await this.request(`${this.origin}/${path}`, {
      body: JSON.stringify(message),
      headers: { 'user-agent': USER_AGENT },
      timeout,
      sendWithin,
      maxBytes: MAX_BYTES,
      onSent,
    });
    if (response.status < 200 || response.status > 299) {
      throw new ThermostatError(CODES.HTTP, `HTTP ${response.status}`, {
        status: response.status,
      });
    }
    const reply = replyOf(parseJson(response.body?.toString('utf8') ?? ''), path);
    if (!reply) throw new ThermostatError(CODES.BAD_ANSWER, `Not a ${path} answer`);
    if (!isAuthorized(reply)) {
      throw new ThermostatError(CODES.UNAUTHORIZED, 'Pairing not confirmed on the thermostat', {
        accStatus: Number.isInteger(reply.acc_status) ? reply.acc_status : null,
      });
    }
    return reply;
  }

  /** A read: tried again when the thermostat closes the connection. */
  async read(path, message, options = {}) {
    return this.serial(
      async () => {
        for (let attempt = 1; ; attempt += 1) {
          try {
            return await this.post(path, message, options);
          } catch (err) {
            if (err?.code !== CODES.RESET || attempt >= READ_TRIES) throw err;
          }
        }
      },
      { deadline: options.deadline },
    );
  }

  /**
   * Ask the thermostat to accept this client: it shows the request on its
   * screen until the user confirms. Resolves the `pair_reply` once accepted,
   * rejects UNAUTHORIZED while not.
   */
  pair(options) {
    const message = {
      pair_message: {
        seqnr: 0,
        account_auth: this.auth(),
        accounts: {
          entries: [
            {
              user_account: '',
              mac_address: this.mac,
              device_name: 'Gladys',
              account_type: 0,
            },
          ],
        },
      },
    };
    return this.read('pair', message, options);
  }

  /** The report, control and configuration: a parsed report (see parse.js). */
  async retrieve(options) {
    const message = { retrieve_message: { seqnr: 0, account_auth: this.auth(), info: INFO } };
    const reply = await this.read('retrieve', message, options);
    const report = parseReport(reply);
    if (!report) throw new ThermostatError(CODES.BAD_ANSWER, 'Not a report');
    return report;
  }

  /**
   * Set control items (`ch_mode_temp`, `ch_control_mode`, `dhw_temp_setp`):
   * sent once, never tried again (it may have been applied). `deadline`
   * bounds the moment it is SENT; the answer gets the usual timeout. The last
   * guard before the wire: known keys only, finite numbers, the hot water
   * setpoint never above 60.
   */
  update(control, { deadline, onSent } = {}) {
    const keys = Object.keys(control ?? {});
    const bad =
      keys.length === 0 ||
      keys.some((key) => !CONTROL_KEYS.includes(key) || !Number.isFinite(control[key])) ||
      ('dhw_temp_setp' in control &&
        !(control.dhw_temp_setp > 0 && control.dhw_temp_setp <= DHW_SETPOINT.HARD_MAX));
    if (bad) {
      return Promise.reject(
        notSent(new ThermostatError(CODES.REFUSED, 'Update refused: not sent')),
      );
    }
    const message = {
      update_message: { seqnr: 0, account_auth: this.auth(), control, configuration: {} },
    };
    return this.serial(() => this.post('update', message, { sendDeadline: deadline, onSent }), {
      deadline,
    });
  }
}
