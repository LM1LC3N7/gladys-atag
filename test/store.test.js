// -----------------------------------------------------------------------------
// /data: the identity drawn once, the times bounded, the file written through
// a temporary file with mode 0600, odd contents ignored.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileStore, newMac, normalizeMemory, serializeMemory } from '../src/store.js';

const NOW = Date.parse('2026-10-25T08:00:00Z');
const fixed = () => Buffer.from([0x01, 0x22, 0x33, 0x44, 0x55, 0x66]);

test('newMac: a locally administered unicast address in the format of pyatag', () => {
  const mac = newMac(fixed);
  assert.equal(mac, '02-22-33-44-55-66', 'bit 1 set (local), bit 0 cleared (unicast)');
  assert.match(newMac(), /^[0-9A-F]{2}(-[0-9A-F]{2}){5}$/);
  assert.notEqual(newMac(), newMac(), 'random');
});

test('normalizeMemory: a fresh identity when none, every time bounded, own keys only', () => {
  const fresh = normalizeMemory(null, NOW, fixed);
  assert.deepEqual(fresh, {
    mac: '02-22-33-44-55-66',
    lastAttemptAt: 0,
    pair: { failures: 0, nextAt: 0 },
    report: { time: null, changedAt: 0 },
  });
  const kept = normalizeMemory(
    {
      mac: '02-AA-BB-CC-DD-EE',
      lastAttemptAt: NOW - 1000,
      pair: { failures: 3, nextAt: NOW + 5000 },
      report: { time: 843_000_000, changedAt: NOW + 9999 },
    },
    NOW,
    fixed,
  );
  assert.deepEqual(kept, {
    mac: '02-AA-BB-CC-DD-EE',
    lastAttemptAt: NOW - 1000,
    pair: { failures: 3, nextAt: NOW + 5000 },
    report: { time: 843_000_000, changedAt: NOW },
  });
  // A clock set back: a time in the future counts as now, a pairing wait capped to 15 min.
  const future = normalizeMemory(
    { mac: 'bad', lastAttemptAt: NOW + 3_600_000, pair: { failures: -1, nextAt: NOW + 3_600_000 } },
    NOW,
    fixed,
  );
  assert.equal(future.mac, '02-22-33-44-55-66');
  assert.equal(future.lastAttemptAt, NOW);
  assert.deepEqual(future.pair, { failures: 0, nextAt: NOW + 15 * 60_000 });
  assert.equal(normalizeMemory({ pair: { nextAt: NOW - 1 } }, NOW, fixed).pair.nextAt, 0);
  assert.equal(
    normalizeMemory(JSON.parse('{"__proto__":{"mac":"x"}}'), NOW, fixed).mac,
    '02-22-33-44-55-66',
  );
  assert.equal(normalizeMemory('text', NOW, fixed).lastAttemptAt, 0);
  assert.deepEqual(serializeMemory({ ...kept, extra: 1 }), kept);
});

test('fileStore: round trip, temporary file and rename, mode 0600, odd files ignored', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'atag-'));
  const path = join(dir, 'state.json');
  const store = fileStore(path);
  assert.equal(await store.load(), null);
  await store.save({
    mac: '02-AA-BB-CC-DD-EE',
    lastAttemptAt: 1,
    pair: { failures: 0, nextAt: 0 },
  });
  assert.deepEqual(await store.load(), {
    mac: '02-AA-BB-CC-DD-EE',
    lastAttemptAt: 1,
    pair: { failures: 0, nextAt: 0 },
  });
  if (process.platform !== 'win32') {
    assert.equal((await stat(path)).mode & 0o777, 0o600);
  }
  await Promise.all([store.save({ a: 1 }), store.save({ a: 2 })]);
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), { a: 2 });
  // Only a missing file is a first start: anything else throws, nothing drawn.
  await writeFile(path, 'not json');
  await assert.rejects(store.load(), (err) => err.code === 'EINVAL');
  await writeFile(path, '[1]');
  await assert.rejects(store.load(), (err) => err.code === 'EINVAL');
  await writeFile(path, `{"x":"${'y'.repeat(5000)}"}`);
  await assert.rejects(store.load(), (err) => err.code === 'EFBIG', 'a large file is not ours');
  if (process.platform !== 'win32' && process.getuid?.() !== 0) {
    await writeFile(path, '{}');
    await chmod(path, 0o000);
    await assert.rejects(store.load(), (err) => err.code === 'EACCES');
    await chmod(path, 0o600);
  }
  assert.equal(await fileStore(join(dir, 'missing.json')).load(), null);
});
