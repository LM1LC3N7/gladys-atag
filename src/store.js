// -----------------------------------------------------------------------------
// What must survive a restart, in /data (the only writable place of the
// container), in atag-state.json, readable by the container user only (0600):
//   - `mac`: the identity this client gives the thermostat (`AA-BB-CC-DD-EE-FF`),
//     drawn at random once: the thermostat ties its authorization to it, a
//     new one would ask the user to confirm the pairing again on the screen;
//   - `lastAttemptAt`: the wall-clock time of the last read, so that a restart
//     never reads sooner than the interval;
//   - `pair`: `{ failures, nextAt }`, the pairing requests sent by the loop
//     (more and more rarely, 8 at most) while the screen is not confirmed;
//   - `report`: `{ time, changedAt }`, the last `report_time` of the thermostat
//     and the wall-clock time it last changed (freshness across a restart).
// A missing file (ENOENT) is a first start: a fresh identity is drawn and
// written. Any other failure to read it (EACCES, EIO, not JSON, too large, no
// identity in it) is NOT a first start: load() throws and the app neither
// rewrites the file nor sends a pairing request (it would replace the paired
// identity). No password exists here. Read back bounded: only known keys of the expected
// shape (never an inherited or `__proto__` key), every time capped.
// -----------------------------------------------------------------------------

import { randomBytes } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { INTERVALS } from './constants.js';

export const STATE_FILE = '/data/atag-state.json';
/** A larger file is not ours: ignored (read bounded). */
const MAX_STATE_BYTES = 4096;
const MAC_PATTERN = /^[0-9A-F]{2}(-[0-9A-F]{2}){5}$/;

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (object, key) =>
  isObject(object) && Object.hasOwn(object, key) ? object[key] : undefined;

export function fileStore(path = STATE_FILE) {
  // One write at a time: two saves never share the temporary file.
  let chain = Promise.resolve();
  return {
    /** The state, null when there is no file yet; throws on any other failure. */
    async load() {
      let text;
      try {
        text = await readFile(path, 'utf8');
      } catch (err) {
        if (err?.code === 'ENOENT') return null;
        throw err;
      }
      if (text.length > MAX_STATE_BYTES) {
        throw Object.assign(new Error('State file too large'), { code: 'EFBIG' });
      }
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw Object.assign(new Error('State file not JSON'), { code: 'EINVAL' });
      }
      if (!isObject(data)) {
        throw Object.assign(new Error('State file not an object'), { code: 'EINVAL' });
      }
      return data;
    },
    save(data) {
      const text = JSON.stringify(data);
      const write = chain.then(async () => {
        const temporary = `${path}.tmp`;
        await writeFile(temporary, text, { mode: 0o600 });
        await rename(temporary, path);
      });
      chain = write.catch(() => {});
      return write;
    },
  };
}

/**
 * For the tests: the same JSON round trip as the file; `failing` refuses every
 * save, `unreadable` makes every load throw (EACCES).
 */
export function memoryStore(initial = null, { failing = false, unreadable = false } = {}) {
  return {
    data: initial === null ? null : JSON.parse(JSON.stringify(initial)),
    saves: 0,
    loads: 0,
    failing,
    unreadable,
    async load() {
      this.loads += 1;
      if (this.unreadable) {
        throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
      }
      return this.data === null ? null : JSON.parse(JSON.stringify(this.data));
    },
    async save(data) {
      if (this.failing) {
        throw new Error('EROFS');
      }
      this.data = JSON.parse(JSON.stringify(data));
      this.saves += 1;
    },
  };
}

/** A kept identity has this shape. */
export const isMac = (value) => typeof value === 'string' && MAC_PATTERN.test(value);

/** A fresh client identity: a locally administered unicast MAC, pyatag's format. */
export function newMac(random = randomBytes) {
  const bytes = random(6);
  bytes[0] = (bytes[0] | 0x02) & 0xfe;
  return [...bytes].map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join('-');
}

/** The persisted state, repaired and bounded against `now` (wall clock). */
export function normalizeMemory(raw, now, random) {
  const mac = own(raw, 'mac');
  const lastAttemptAt = own(raw, 'lastAttemptAt');
  const pair = own(raw, 'pair');
  const failures = own(pair, 'failures');
  const nextAt = own(pair, 'nextAt');
  const report = own(raw, 'report');
  const time = own(report, 'time');
  const changedAt = own(report, 'changedAt');
  return {
    mac: isMac(mac) ? mac : newMac(random),
    // A time in the future (a clock set back) counts as "just now", never later.
    lastAttemptAt:
      Number.isFinite(lastAttemptAt) && lastAttemptAt > 0 ? Math.min(lastAttemptAt, now) : 0,
    pair: {
      failures: Number.isInteger(failures) && failures > 0 ? Math.min(failures, 1000) : 0,
      nextAt:
        Number.isFinite(nextAt) && nextAt > now ? Math.min(nextAt, now + INTERVALS.PAIR_MAX_MS) : 0,
    },
    // A change dated in the future (a clock set back) counts as "just now".
    report:
      Number.isInteger(time) && Number.isFinite(changedAt) && changedAt > 0
        ? { time, changedAt: Math.min(changedAt, now) }
        : { time: null, changedAt: 0 },
  };
}

export const serializeMemory = ({ mac, lastAttemptAt, pair, report }) => ({
  mac,
  lastAttemptAt,
  pair: { failures: pair.failures, nextAt: pair.nextAt },
  report: { time: report.time, changedAt: report.changedAt },
});
