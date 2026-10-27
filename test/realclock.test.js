// -----------------------------------------------------------------------------
// The app on a REAL moving clock (performance.now, Date.now, setTimeout) and a
// real local HTTP server playing the thermostat: the reads really start, at
// 0, the interval and twice the interval, with a bounded number of timers.
// The time is sped up 20 times (60 s of the interval are 3 s) but it is
// the real clock: it moves between any two reads of it.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { AtagApp } from '../src/app.js';
import { INTERVALS } from '../src/constants.js';
import { memoryStore } from '../src/store.js';
import { createFakeThermostat } from './helpers/fakeThermostat.js';

const SPEED = 20;
const INTERVAL = INTERVALS.POLL_MS;

test('real clock: reads at 0, the interval and twice the interval; timers bounded', async () => {
  const fake = createFakeThermostat();
  const server = await fake.listen();
  const reads = [];
  const original = fake.requests;
  fake.requests = new Proxy(original, {
    set(target, key, value) {
      if (key !== 'length' && value?.path === '/retrieve') reads.push(performance.now() * SPEED);
      target[key] = value;
      return true;
    },
  });
  let timersSet = 0;
  const timers = {
    setTimeout(fn, ms) {
      timersSet += 1;
      return setTimeout(fn, Math.max(0, ms) / SPEED);
    },
    clearTimeout: (id) => clearTimeout(id),
  };
  const gladys = createFakeGladys({ selector: 'atag', config: {} });
  await gladys.connect();
  const quiet = () => {};
  const app = new AtagApp({
    gladys,
    logger: { info: quiet, warn: quiet, error: quiet, debug: quiet },
    now: () => Date.now() * SPEED,
    monotonic: () => performance.now() * SPEED,
    timers,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms / SPEED)),
    store: memoryStore(),
  });
  const started = performance.now() * SPEED;
  try {
    await app.start({ host: `127.0.0.1:${server.port}` });
    const deadline = started + INTERVAL;
    while (reads.length === 0 && performance.now() * SPEED < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    const until = (reads[0] ?? started) + 2.5 * INTERVAL;
    while (performance.now() * SPEED < until) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    await app.stop();
  } finally {
    await server.close();
  }
  const at = reads.map((t) => Math.round(t - started));
  assert.equal(reads.length, 3, `reads at ${at}`);
  assert.ok(reads[0] - started < INTERVAL / 2, `the first read at once: ${at}`);
  for (let i = 1; i < reads.length; i += 1) {
    const gap = reads[i] - reads[i - 1];
    assert.ok(gap >= 0.9 * INTERVAL, `never sooner than the interval: ${at}`);
    assert.ok(gap < 1.5 * INTERVAL, `on time: ${at}`);
  }
  assert.ok(timersSet <= 10, `${timersSet} timers`);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(fake.requests.filter((r) => r.path === '/pair').length, 0, 'already paired');
});
