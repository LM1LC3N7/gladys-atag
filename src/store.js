// -----------------------------------------------------------------------------
// What must survive a restart, in /data (the only writable place of the
// container), in atag-state.json, readable by the container user only (0600):
//   - `mac`: the identity this client gives the thermostat (`AA-BB-CC-DD-EE-FF`),
//     drawn at random once: the thermostat ties its authorization to it, a
//     new one would ask the user to confirm the pairing again on the screen;
//   - `lastAttemptAt`: the wall-clock time of the last read, so that a restart
//     never reads sooner than the interval;
//   - `pair`: `{ failures, nextAt }`, the pairing requests sent again more and
//     more rarely while the screen is not confirmed.
// No password exists here. Read back bounded: only known keys of the expected
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
    async load() {
      try {
        const text = await readFile(path, 'utf8');
        return text.length > MAX_STATE_BYTES ? null : JSON.parse(text);
      } catch {
        return null;
      }
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

/** For the tests: the same JSON round trip as the file; `failing` refuses every save. */
export function memoryStore(initial = null, { failing = false } = {}) {
  return {
    data: initial === null ? null : JSON.parse(JSON.stringify(initial)),
    saves: 0,
    failing,
    async load() {
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
  return {
    mac: typeof mac === 'string' && MAC_PATTERN.test(mac) ? mac : newMac(random),
    // A time in the future (a clock set back) counts as "just now", never later.
    lastAttemptAt:
      Number.isFinite(lastAttemptAt) && lastAttemptAt > 0 ? Math.min(lastAttemptAt, now) : 0,
    pair: {
      failures: Number.isInteger(failures) && failures > 0 ? Math.min(failures, 1000) : 0,
      nextAt:
        Number.isFinite(nextAt) && nextAt > now ? Math.min(nextAt, now + INTERVALS.PAIR_MAX_MS) : 0,
    },
  };
}

export const serializeMemory = ({ mac, lastAttemptAt, pair }) => ({
  mac,
  lastAttemptAt,
  pair: { failures: pair.failures, nextAt: pair.nextAt },
});
