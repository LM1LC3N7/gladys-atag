// -----------------------------------------------------------------------------
// AtagApp: the integration. One Atag One thermostat, its boiler and hot water.
//
//   start(config)  (re)connects: the client built on the identity kept in
//                  /data, the reading loop armed. The same configuration again
//                  (Gladys reconnected) only publishes everything again; the
//                  client, the pairing state and the pace stay.
//   reading loop   every 60 s: a pairing request while the thermostat has not
//                  accepted this client (confirmed once on its screen), then
//                  the report. The thermostat unreachable: the next try 1 to
//                  10 min later (never faster than the reading); the pairing
//                  not confirmed: asked again 1 to 15 min later.
//   setValue       the room setpoint, the control mode and the hot water
//                  setpoint, each behind its own option, see "Commands".
//
// Two clocks: `now` (wall clock) dates what /data keeps; `monotonic` paces the
// reads, the retries and the freshness, so that a wall clock set back or
// forward never stops nor hurries them. One read of the clock per decision:
// dueAt(mono) computes on the caller's instant. One timer at a time.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { CODES, isUnauthorized } from './atag/errors.js';
import { ThermostatClient } from './atag/client.js';
import { toDeviceUnit } from './atag/parse.js';
import { normalizeConfig } from './config.js';
import {
  BOILER_FEATURES as BF,
  BOILER_TYPE,
  COMMAND_ACK_MS,
  COMMAND_BUDGET_MS,
  COMMAND_MIN_READ_MS,
  COMMAND_MIN_SEND_MS,
  CONFIRM_AFTER_MS,
  DEVICE_ID_PATTERN,
  DHW_SETPOINT,
  GLADYS_MODE,
  INTERVALS,
  ROOM_SETPOINT,
  THERMOSTAT_FEATURES as TF,
  THERMOSTAT_TYPE,
} from './constants.js';
import {
  buildBoilerDevice,
  buildThermostatDevice,
  chControlModeOf,
  createdDevices,
  gladysModeOf,
  parseExternalId,
  statesOf,
} from './devices.js';
import { T } from './i18n.js';
import { StatePublisher } from './publisher.js';
import { fileStore, normalizeMemory, serializeMemory } from './store.js';

/** The "Test the connection" button waits 30 s: answer before. */
const TEST_BUDGET_MS = 25_000;
/** Entries per publishTransports call (the SDK refuses more). */
const TRANSPORTS_PER_CALL = 100;
const defaultTimers = { setTimeout, clearTimeout };
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const near = (a, b, step) => a !== null && a !== undefined && Math.abs(a - b) < step / 2;
const half = (value) => Math.round(value * 2) / 2;

/** A command value: a finite number, never a boolean, null or an empty string. */
function numberOf(value) {
  if (typeof value === 'boolean' || value === null || value === undefined || value === '') {
    return null;
  }
  const raw = Number(value);
  return Number.isFinite(raw) ? raw : null;
}

export class AtagApp {
  /**
   * @param {object} options
   * @param {import('@gladysassistant/integration-sdk').GladysIntegration} options.gladys
   * @param {object} [options.logger]
   * @param {Function} [options.request] the HTTP transport (tests inject a fake thermostat)
   * @param {() => number} [options.now] wall clock (ms)
   * @param {() => number} [options.monotonic] monotonic clock (ms)
   * @param {{ setTimeout: Function, clearTimeout: Function }} [options.timers]
   * @param {(ms: number) => Promise<void>} [options.sleep] the spacing between two requests
   * @param {{ load: Function, save: Function }} [options.store] /data
   * @param {(size: number) => Buffer} [options.random]
   */
  constructor({
    gladys,
    logger = createLogger({ name: 'atag' }),
    request,
    now = Date.now,
    monotonic = () => performance.now(),
    timers = defaultTimers,
    sleep,
    store = fileStore(),
    random,
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.request = request;
    this.now = now;
    this.monotonic = monotonic;
    this.timers = timers;
    this.sleep = sleep;
    this.store = store;
    this.random = random;
    this.publisher = new StatePublisher({ gladys, logger, monotonic });
    this.rawConfig = {};
    this.config = normalizeConfig();
    this.configKey = null;
    this.client = null;
    this.generation = 0;
    this.epoch = 0;
    this.running = false;
    this.timer = undefined;
    this.confirmTimer = undefined;
    this.queue = Promise.resolve();
    /** One thermostat: the commands run one after the other. */
    this.commands = Promise.resolve();
    this.activeCommands = 0;
    this.busy = undefined;
    this.lastStatus = null;
    /** What /data keeps (loaded once, kept across configurations). */
    this.memory = undefined;
    this.lastSavedAt = undefined;
    this.saveWarned = false;
    /** The pace: monotonic instants (undefined: none). */
    this.lastReadAt = undefined;
    this.nextTryAt = undefined;
    this.pairDueAt = undefined;
    this.retryDelay = INTERVALS.RETRY_MIN_MS;
    this.reset();
  }

  reset() {
    this.online = false;
    this.authorized = false;
    this.report = null;
    this.deviceId = null;
    this.lastReportTime = undefined;
    this.reportMono = undefined;
    this.stale = false;
    this.discoveredKey = null;
    this.transports = new Map();
  }

  // --- Lifecycle -------------------------------------------------------------

  /** Run `task` after every start already queued. */
  enqueue(task) {
    const run = this.queue.then(task);
    this.queue = run.catch(() => {});
    return run;
  }

  /**
   * (Re)start with a configuration. Calls are serialized. `force`: the user
   * asked (button, saved configuration): the pairing is asked again at the
   * next read and the retry delay starts over.
   */
  start(rawConfig, { force = false } = {}) {
    return this.enqueue(() => this.run(rawConfig, { force }));
  }

  async stop() {
    this.running = false;
    this.generation += 1;
    this.halt();
    this.dropClient();
    // /data written at a clean stop: the time of the last read is exact.
    if (this.memory && this.lastSavedAt !== this.memory.lastAttemptAt) await this.save();
  }

  /** Gladys went away: the loop stops, everything else (client, pairing, pace) stays. */
  pause() {
    this.halt();
  }

  /** Clear the timers; the runs still in flight will not schedule again. */
  halt() {
    this.epoch += 1;
    if (this.timer !== undefined) {
      this.timers.clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (this.confirmTimer !== undefined) {
      this.timers.clearTimeout(this.confirmTimer);
      this.confirmTimer = undefined;
    }
  }

  dropClient() {
    this.client?.close();
    this.client = null;
  }

  async loadMemory() {
    if (this.memory) return;
    const raw = await this.store.load();
    this.memory = normalizeMemory(raw, this.now(), this.random);
    this.lastSavedAt = raw ? this.memory.lastAttemptAt : undefined;
    // The last read before the restart, brought onto the monotonic clock.
    if (this.memory.lastAttemptAt > 0) {
      const age = Math.max(0, this.now() - this.memory.lastAttemptAt);
      if (age < INTERVALS.POLL_MS) this.lastReadAt = this.monotonic() - age;
    }
    if (this.memory.pair.nextAt > 0) {
      this.pairDueAt = this.monotonic() + (this.memory.pair.nextAt - this.now());
    }
  }

  async save() {
    if (!this.memory) return;
    try {
      await this.store.save(serializeMemory(this.memory));
      this.lastSavedAt = this.memory.lastAttemptAt;
      this.saveWarned = false;
    } catch (err) {
      if (!this.saveWarned) this.logger.warn(`/data not written: ${err?.code ?? err?.message}`);
      this.saveWarned = true;
    }
  }

  /** The time of a read, kept BEFORE it; written at most once a minute. */
  async saveAttempt(now) {
    this.memory.lastAttemptAt = now;
    if (this.lastSavedAt === undefined || now - this.lastSavedAt >= INTERVALS.SAVE_ATTEMPT_MS) {
      await this.save();
    }
  }

  async run(rawConfig, { force = false } = {}) {
    const config = normalizeConfig(rawConfig);
    const key = JSON.stringify(config);
    if (this.client && key === this.configKey) {
      // The same configuration: the client, the pairing state and the pace
      // stay. The user asked (force): the retries and the pairing backoff are
      // lifted, the next read still never sooner than the interval.
      if (force) await this.lift();
      await this.resume();
      return;
    }
    this.halt();
    this.dropClient();
    this.generation += 1;
    this.running = true;
    this.rawConfig = rawConfig ?? {};
    this.config = config;
    this.configKey = key;
    this.reset();
    this.lastStatus = null;
    this.gladys.forgetPublishedStates?.();

    const invalid = this.configProblem(config);
    if (invalid) {
      await this.setStatus(false, invalid);
      return;
    }
    await this.loadMemory();
    if (force) await this.lift();
    this.client = new ThermostatClient({
      origin: config.thermostat.origin,
      mac: this.memory.mac,
      request: this.request,
      monotonic: this.monotonic,
      ...(this.sleep ? { sleep: this.sleep } : {}),
    });
    this.logger.info(`Using the thermostat at ${config.thermostat.origin}`);
    this.schedule();
  }

  /**
   * The user asked (button, saved configuration): the pairing is asked again
   * at the next read, the retries start over. Never a read sooner than the
   * interval though.
   */
  async lift() {
    this.nextTryAt = undefined;
    this.pairDueAt = undefined;
    this.retryDelay = INTERVALS.RETRY_MIN_MS;
    if (this.memory.pair.failures > 0 || this.memory.pair.nextAt > 0) {
      this.memory.pair = { failures: 0, nextAt: 0 };
      await this.save();
    }
  }

  configProblem(config) {
    if (config.hostError) {
      return (
        {
          empty: T.status.hostEmpty,
          credentials: T.status.hostCredentials,
          https: T.status.hostHttps,
        }[config.hostError] ?? T.status.hostInvalid
      );
    }
    if (config.dhwMaxInvalid) {
      return T.status.dhwMaxInvalid(DHW_SETPOINT.FLOOR, DHW_SETPOINT.HARD_MAX, config.dhwMax);
    }
    return null;
  }

  /**
   * Gladys reconnected with the same configuration: everything is published
   * again (Gladys may have lost it), the reading loop goes on where it was.
   */
  async resume() {
    this.halt();
    const status = this.lastStatus ? JSON.parse(this.lastStatus) : null;
    this.lastStatus = null;
    this.transports.clear();
    this.discoveredKey = null;
    this.gladys.forgetPublishedStates?.();
    if (status) await this.setStatus(status[0], status[1]);
    if (this.deviceId) await this.publishDiscovered();
    await this.publishStates();
    await this.publishTransports();
    this.schedule();
  }

  // --- Pace ------------------------------------------------------------------

  /** The monotonic time from which the next read may start, from the caller's instant `mono`. */
  dueAt(mono) {
    let due = this.lastReadAt === undefined ? mono : this.lastReadAt + INTERVALS.POLL_MS;
    if (this.nextTryAt !== undefined) due = Math.max(due, this.nextTryAt);
    if (this.pairDueAt !== undefined) due = Math.max(due, this.pairDueAt);
    return due;
  }

  /** One timer: the next read when it is due. */
  schedule() {
    if (this.timer !== undefined) {
      this.timers.clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (!this.running || !this.client) return;
    const epoch = this.epoch;
    const mono = this.monotonic();
    const wait = Math.max(0, this.dueAt(mono) - mono);
    this.timer = this.timers.setTimeout(async () => {
      this.timer = undefined;
      try {
        await this.tick();
      } catch (err) {
        this.logger.error(`Unexpected error (${err?.name ?? 'Error'})`);
      }
      if (epoch === this.epoch && this.running) this.schedule();
    }, wait);
  }

  /** One read when it is due; a read running is never doubled. */
  tick({ confirm = false } = {}) {
    if (this.busy) return this.busy;
    this.busy = this.read({ confirm }).finally(() => {
      this.busy = undefined;
    });
    return this.busy;
  }

  /**
   * One round: the pairing request while not authorized, then the report.
   * `confirm`: the read that follows a command, whatever the pace.
   */
  async read({ confirm }) {
    const client = this.client;
    if (!client || !this.running) return;
    const mono = this.monotonic();
    if (!confirm && mono < this.dueAt(mono)) return;
    /** Another configuration (or a stop) during an await: this read gives up, silently. */
    const gone = () => client !== this.client || !this.running;
    this.lastReadAt = mono;
    // Kept BEFORE the request: a restart during it never reads again sooner.
    await this.saveAttempt(this.now());
    if (gone()) return;
    let report;
    try {
      if (!this.authorized) {
        await client.pair();
        if (gone()) return;
        this.authorized = true;
        this.logger.info('The thermostat accepted the pairing');
      }
      report = await client.retrieve();
    } catch (err) {
      if (gone()) return;
      await this.failed(err, mono);
      return;
    }
    if (gone()) return;
    await this.succeeded(report, mono);
  }

  /** A reading failed: the pairing to confirm, or a retry with a growing delay. */
  async failed(err, mono) {
    const wasOnline = this.online;
    this.online = false;
    await this.publishTransports();
    if (isUnauthorized(err)) {
      this.authorized = false;
      const pair = this.memory.pair;
      pair.failures = Math.min(pair.failures + 1, 1000);
      const delay = clamp(
        INTERVALS.PAIR_MIN_MS * 2 ** (pair.failures - 1),
        INTERVALS.PAIR_MIN_MS,
        INTERVALS.PAIR_MAX_MS,
      );
      pair.nextAt = this.now() + delay;
      this.pairDueAt = mono + delay;
      await this.save();
      if (pair.failures === 1) this.logger.warn('Pairing not confirmed on the thermostat');
      await this.setStatus(false, T.status.pairing(delay));
      return;
    }
    const delay = this.retryDelay;
    this.retryDelay = Math.min(this.retryDelay * 2, INTERVALS.RETRY_MAX_MS);
    this.nextTryAt = mono + delay;
    if (wasOnline || delay === INTERVALS.RETRY_MIN_MS) {
      // Our own message: a code or an HTTP status, never the text of the answer.
      this.logger.warn(
        `The thermostat fails: ${err?.code ?? 'error'} ${err?.message ?? ''}`.trim(),
      );
    }
    await this.setStatus(false, this.errorMessage(err, delay));
  }

  errorMessage(err, delay) {
    if (err?.code === CODES.BAD_ANSWER || err?.code === CODES.TOO_LARGE || err?.status === 404) {
      return T.status.notThermostat(delay);
    }
    return T.status.unreachable(err, delay);
  }

  /** A report arrived: identity, freshness, then everything published. */
  async succeeded(report, mono) {
    if (!report.deviceId || !DEVICE_ID_PATTERN.test(report.deviceId)) {
      await this.failed(
        Object.assign(new Error('No device id in the report'), { code: CODES.BAD_ANSWER }),
        mono,
      );
      return;
    }
    this.authorized = true;
    this.retryDelay = INTERVALS.RETRY_MIN_MS;
    this.nextTryAt = undefined;
    this.pairDueAt = undefined;
    if (this.memory.pair.failures > 0 || this.memory.pair.nextAt > 0) {
      this.memory.pair = { failures: 0, nextAt: 0 };
      await this.save();
    }
    // Freshness on the thermostat's own stamp: a report whose time stopped
    // moving for 2 h is not published (a thermostat stuck on old values).
    if (report.reportTime === null || report.reportTime !== this.lastReportTime) {
      this.lastReportTime = report.reportTime;
      this.reportMono = mono;
    }
    const stale = mono - this.reportMono > INTERVALS.STALE_MS;
    if (stale && !this.stale) this.logger.warn('The report of the thermostat does not move');
    this.stale = stale;
    this.report = report;
    this.online = true;
    if (this.deviceId !== report.deviceId) {
      if (this.deviceId) this.logger.info(`Another thermostat answers: ${report.deviceId}`);
      this.deviceId = report.deviceId;
    }
    if (this.discoveredKey !== this.deviceId) await this.publishDiscovered();
    await this.publishStates();
    await this.publishTransports();
    await this.setStatus(true, T.status.ok({ deviceId: this.deviceId, stale }));
  }

  async setStatus(connected, message) {
    const key = JSON.stringify([connected, message]);
    if (key === this.lastStatus) return;
    this.lastStatus = key;
    await this.gladys.setConnectionStatus(connected, message).catch((err) => {
      this.lastStatus = null;
      this.logger.warn(`Connection status not sent: ${err.message}`);
    });
  }

  // --- Publishing ------------------------------------------------------------

  /** Never throws: a refusal of Gladys is not a failure of the thermostat. */
  async publishDiscovered() {
    const language = this.config.language;
    const devices = this.deviceId
      ? [
          buildThermostatDevice(this.gladys, this.deviceId, language),
          buildBoilerDevice(this.gladys, this.deviceId, language),
        ]
      : [];
    try {
      await this.gladys.publishDiscoveredDevices(devices);
      this.discoveredKey = this.deviceId;
    } catch (err) {
      this.logger.warn(`Discovery not published: ${err.message}`);
    }
  }

  /** Discovery (scan button): what is known; never a read sooner than the pace. */
  async publishDiscovery() {
    await this.publishDiscovered();
  }

  /** The states of the created devices of the thermostat that answers. */
  states() {
    if (!this.report || !this.online || this.stale) return [];
    return statesOf(this.gladys, createdDevices(this.gladys), this.report, this.config.language);
  }

  publishStates() {
    return this.publisher.publish(this.states());
  }

  async publishTransports() {
    const entries = [];
    for (const { deviceId, externalId } of createdDevices(this.gladys)) {
      const reachable = this.online && deviceId === this.deviceId;
      const entry = { external_id: externalId, transport: reachable ? 'local' : 'unreachable' };
      if (reachable && this.stale) {
        entry.degraded = true;
        entry.message = {
          en: 'The report of the thermostat has not moved for more than 2 hours',
          fr: 'Le rapport du thermostat ne bouge plus depuis plus de 2 heures',
        };
      }
      entries.push(entry);
    }
    const changed = entries.filter(
      (e) => this.transports.get(e.external_id) !== JSON.stringify([e.transport, e.degraded]),
    );
    for (let start = 0; start < changed.length; start += TRANSPORTS_PER_CALL) {
      const batch = changed.slice(start, start + TRANSPORTS_PER_CALL);
      for (const e of batch) {
        this.transports.set(e.external_id, JSON.stringify([e.transport, e.degraded]));
      }
      await this.gladys.publishTransports(batch).catch((err) => {
        for (const e of batch) this.transports.delete(e.external_id);
        this.logger.debug(`Transports not published: ${err.message}`);
      });
    }
  }

  // --- Commands --------------------------------------------------------------
  //
  // Three commands, each refused unless the user allowed it (off by default):
  // the room setpoint (`allow_setpoint`, 4 to 27 °C by half degrees), the
  // control mode (`allow_mode`, Heating or Auto: this thermostat has no
  // "off") and the hot water setpoint (`allow_dhw_setpoint`, between the
  // thermostat's own bounds and under the user's cap, 60 °C at most). The
  // permission is checked when the command arrives AND just before it is
  // sent; a value outside the bounds is refused, never clamped. The commands
  // run one after the other (one thermostat), use the client of the moment
  // they arrived (a new configuration in between refuses them), and read the
  // report just before acting: the pairing not confirmed, another thermostat
  // answering, or a read that fails, and nothing is sent; the value already
  // there, and nothing is sent either. Gladys waits 5 s: past 3.5 s after the
  // command arrived, nothing is sent any more; once sent, Gladys gets its
  // answer at most 4.3 s after the command, and the report is read again 5 s
  // later: only that read confirms the value.

  async setValue(device, feature, value) {
    const received = this.monotonic();
    const parsed = parseExternalId(this.gladys, feature?.external_id);
    const spec = this.commandSpec(parsed, value);
    if (!spec) throw new Error(T.errors.unknownDevice);
    if (spec.error) throw new Error(spec.error);
    this.allowed(spec);
    const client = this.client;
    if (!client) throw new Error(T.errors.notConnected);
    if (!this.authorized) throw new Error(T.errors.pairing);
    const generation = this.generation;
    const run = this.commands.then(() => this.command(received, { client, generation, spec }));
    this.commands = run.catch(() => {});
    return run;
  }

  /** What a command is: { kind, parsed, value } | { error } | null (not a command). */
  commandSpec(parsed, value) {
    if (!parsed) return null;
    if (parsed.kind === THERMOSTAT_TYPE && parsed.feature === TF.TARGET) {
      const raw = numberOf(value);
      // The raw value is checked BEFORE rounding: 27.2 and 3.8 are refused.
      if (raw === null || raw < ROOM_SETPOINT.MIN || raw > ROOM_SETPOINT.MAX) {
        return { error: T.errors.invalidValue(ROOM_SETPOINT.MIN, ROOM_SETPOINT.MAX) };
      }
      return { kind: 'setpoint', parsed, value: half(raw) };
    }
    if (parsed.kind === THERMOSTAT_TYPE && parsed.feature === TF.MODE) {
      const raw = numberOf(value);
      if (raw !== GLADYS_MODE.HEATING && raw !== GLADYS_MODE.AUTO) {
        return { error: T.errors.invalidMode };
      }
      return { kind: 'mode', parsed, value: raw };
    }
    if (parsed.kind === BOILER_TYPE && parsed.feature === BF.DHW_TARGET) {
      const raw = numberOf(value);
      const max = Math.min(this.config.dhwMax, DHW_SETPOINT.HARD_MAX);
      if (raw === null || raw < DHW_SETPOINT.FLOOR || raw > max) {
        return { error: T.errors.invalidValue(DHW_SETPOINT.FLOOR, max) };
      }
      return { kind: 'dhw', parsed, value: half(raw) };
    }
    return null;
  }

  /** The option of the command is ticked (checked when it arrives and before sending). */
  allowed(spec) {
    if (spec.kind === 'setpoint' && !this.config.allowSetpoint) {
      throw new Error(T.errors.setpointDisabled);
    }
    if (spec.kind === 'mode' && !this.config.allowMode) throw new Error(T.errors.modeDisabled);
    if (spec.kind === 'dhw' && !this.config.allowDhwSetpoint) throw new Error(T.errors.dhwDisabled);
  }

  /** The client, the configuration and the permission are still those of the command. */
  stillValid({ client, generation, spec }) {
    if (client !== this.client || generation !== this.generation || !this.running) {
      throw new Error(T.errors.configChanged);
    }
    this.allowed(spec);
    if (!this.authorized) throw new Error(T.errors.pairing);
  }

  /** A failure of the thermostat met by a command: the pairing lost applies to every path. */
  async shared(err, generation, mono) {
    if (isUnauthorized(err) && generation === this.generation) await this.failed(err, mono);
  }

  async command(received, { client, generation, spec }) {
    this.activeCommands += 1;
    try {
      this.stillValid({ client, generation, spec });
      const deadline = received + COMMAND_BUDGET_MS;
      const mono = this.monotonic();
      if (deadline - mono < COMMAND_MIN_READ_MS) throw new Error(T.errors.tooSlow);
      let report;
      try {
        report = await client.retrieve({ deadline: deadline - COMMAND_MIN_SEND_MS });
      } catch (err) {
        await this.shared(err, generation, mono);
        throw new Error(T.errors.unknownState(err), { cause: err });
      }
      // The fresh state is published without waiting: Gladys must get its
      // answer within 5 s.
      this.observed(report, generation);
      if (report.deviceId !== spec.parsed.deviceId) throw new Error(T.errors.otherThermostat);
      const control = this.controlOf(spec, report);
      if (control === null) return; // already there: nothing sent
      if (deadline - this.monotonic() < COMMAND_MIN_SEND_MS) throw new Error(T.errors.tooSlow);
      // The last check before acting: the user may have changed things meanwhile.
      this.stillValid({ client, generation, spec });
      await this.send({ client, generation, spec, control, received, deadline });
    } finally {
      this.activeCommands -= 1;
    }
  }

  /**
   * The `control` to send for a command against the fresh report, or null
   * when the value is already there. The hot water bounds are the
   * thermostat's own, under the user's cap.
   */
  controlOf(spec, report) {
    if (spec.kind === 'setpoint') {
      if (near(report.targetTemperature, spec.value, ROOM_SETPOINT.STEP)) return null;
      return { ch_mode_temp: toDeviceUnit(spec.value, report.fahrenheit) };
    }
    if (spec.kind === 'mode') {
      if (gladysModeOf(report.chControlMode) === spec.value) return null;
      return { ch_control_mode: chControlModeOf(spec.value) };
    }
    const min = report.dhwMin ?? DHW_SETPOINT.FLOOR;
    const max = Math.min(
      report.dhwMax ?? DHW_SETPOINT.HARD_MAX,
      this.config.dhwMax,
      DHW_SETPOINT.HARD_MAX,
    );
    if (spec.value < min || spec.value > max) throw new Error(T.errors.invalidValue(min, max));
    if (near(report.dhwTarget, spec.value, DHW_SETPOINT.STEP)) return null;
    return { dhw_temp_setp: toDeviceUnit(spec.value, report.fahrenheit) };
  }

  /** Send, then answer Gladys on the thermostat's answer or at COMMAND_ACK_MS, whichever first. */
  async send({ client, generation, spec, control, received, deadline }) {
    let sent = false;
    const request = client.update(control, {
      deadline,
      onSent: () => {
        sent = true;
      },
    });
    let handle;
    const ack = new Promise((resolve) => {
      handle = this.timers.setTimeout(
        resolve,
        Math.max(0, received + COMMAND_ACK_MS - this.monotonic()),
      );
    });
    const outcome = await Promise.race([
      request.then(
        () => ({ done: true }),
        (err) => ({ err }),
      ),
      ack.then(() => ({ pending: true })),
    ]);
    this.timers.clearTimeout(handle);
    const label = `Command ${spec.kind} (${Object.keys(control).join(',')})`;
    if (outcome.done) {
      this.logger.info(`${label} sent`);
      this.scheduleConfirm(generation);
      return;
    }
    if (outcome.pending) {
      // Sent, the thermostat still at work: Gladys is answered now, the read follows.
      this.logger.info(`${label} sent, the thermostat has not answered yet`);
      request.then(
        () => {
          if (generation === this.generation) this.scheduleConfirm(generation);
        },
        async (err) => {
          this.logger.warn(`${label} not confirmed: ${err?.code ?? 'error'}`);
          if (generation !== this.generation) return;
          await this.shared(err, generation, this.monotonic());
          // It may have been applied: read again anyway.
          this.scheduleConfirm(generation);
        },
      );
      return;
    }
    const { err } = outcome;
    await this.shared(err, generation, this.monotonic());
    if (err?.notSent || !sent) throw new Error(T.errors.notSent(err), { cause: err });
    // Sent, refused or lost: it may have been applied, the next read tells.
    this.scheduleConfirm(generation);
    throw new Error(T.errors.refused(err), { cause: err });
  }

  /** The read that confirms a command, CONFIRM_AFTER_MS after its answer (one at a time). */
  scheduleConfirm(generation) {
    if (generation !== this.generation || !this.running) return;
    if (this.confirmTimer !== undefined) this.timers.clearTimeout(this.confirmTimer);
    const epoch = this.epoch;
    this.confirmTimer = this.timers.setTimeout(async () => {
      this.confirmTimer = undefined;
      if (epoch !== this.epoch || generation !== this.generation) return;
      try {
        await this.tick({ confirm: true });
      } catch (err) {
        this.logger.error(`Unexpected error (${err?.name ?? 'Error'})`);
      }
      // The pace goes on from this read.
      if (epoch === this.epoch && this.running) this.schedule();
    }, CONFIRM_AFTER_MS);
  }

  /** What a command just read, until the next reading (published in the background). */
  observed(report, generation) {
    if (generation !== this.generation || !this.online) return;
    if (report.deviceId !== this.deviceId) return;
    this.report = report;
    void this.publishStates();
  }

  // --- Devices created / deleted in Gladys -----------------------------------

  async deviceCreated(device) {
    if (!parseExternalId(this.gladys, device?.external_id) || !this.online) return;
    await this.publishStates();
    await this.publishTransports();
  }

  async deviceUpdated(device) {
    this.transports.delete(device?.external_id);
    await this.deviceCreated(device);
  }

  deviceDeleted(device) {
    this.transports.delete(device?.external_id);
  }

  // --- Configuration button --------------------------------------------------

  /** Resolves `promise`, or rejects with `message` after `ms`. */
  within(promise, ms, message) {
    let handle;
    const limit = new Promise((_, reject) => {
      handle = this.timers.setTimeout(() => reject(new Error(message)), ms);
    });
    return Promise.race([promise, limit]).finally(() => this.timers.clearTimeout(handle));
  }

  /**
   * The pairing asked again and the retries started over (the user asked),
   * a read now when the pace allows it (never sooner than the interval),
   * then a report, within 25 s.
   */
  async testConnection() {
    await this.within(this.test(), TEST_BUDGET_MS, T.errors.testTooLong);
    const mono = this.monotonic();
    if (this.online && this.lastReadAt !== undefined) {
      return T.test.ok({ deviceId: this.deviceId, ago: mono - this.lastReadAt });
    }
    const message = this.lastStatus ? JSON.parse(this.lastStatus)[1] : null;
    const left = this.client ? this.dueAt(mono) - mono : 0;
    if (left > 0 && !this.online) {
      throw new Error(`${message?.en ?? T.errors.notConnected} ${T.test.wait(left).en}`);
    }
    throw new Error(message?.en ?? T.errors.notConnected);
  }

  async test() {
    await this.start(this.rawConfig, { force: true });
    if (!this.client) return;
    const mono = this.monotonic();
    if (mono >= this.dueAt(mono)) {
      await this.tick();
      this.schedule();
    }
  }
}
