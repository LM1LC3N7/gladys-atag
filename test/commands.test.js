// -----------------------------------------------------------------------------
// The commands: room setpoint, control mode, hot water setpoint. Each behind
// its option (off by default), decided on a fresh read, bounded, sent once,
// confirmed by the read that follows.
// -----------------------------------------------------------------------------

import { afterEach, test } from 'node:test';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { AtagApp } from '../src/app.js';
import { registerHandlers } from '../src/handlers.js';
import { memoryStore } from '../src/store.js';
import assert from 'node:assert/strict';
import { COMMAND_ACK_MS, CONFIRM_AFTER_MS } from '../src/constants.js';
import {
  MINUTE,
  SECOND,
  boiler,
  feature,
  settle,
  setup,
  state,
  thermostat,
} from './helpers/app.js';
import { DEVICE_ID, OTHER_DEVICE_ID, createFakeThermostat } from './helpers/fakeThermostat.js';

let running;
afterEach(async () => {
  await running?.stop();
  running = undefined;
});
const boot = async (options) => {
  const world = await setup(options);
  running = world.app;
  return world;
};
const ALL = { allow_setpoint: true, allow_mode: true, allow_dhw_setpoint: true };
const set = (gladys, device, key, value) =>
  gladys.fake.setValue(device, feature(device, key), value);

test('every command is refused by default, nothing sent, the reason said', async () => {
  const { gladys, fake } = await boot();
  const t = thermostat();
  const b = boiler();
  const before = fake.requests.length;
  for (const [device, key, value, pattern] of [
    [t, 'target', 21, /Changing the room setpoint is disabled/],
    [t, 'mode', 1, /Changing the mode is disabled/],
    [b, 'dhw_target', 50, /Changing the hot water setpoint is disabled/],
  ]) {
    const result = await set(gladys, device, key, value);
    assert.equal(result.success, false);
    assert.match(result.error, pattern);
  }
  assert.equal(fake.requests.length, before);
  assert.equal(fake.updates.length, 0);
});

test('room setpoint: fresh read, then ch_mode_temp sent; confirmed by the read 5 s later', async () => {
  const { gladys, fake, wait, pending, clock } = await boot({ config: ALL });
  const t = thermostat();
  const before = fake.requests.length;
  const result = await set(gladys, t, 'target', 21);
  assert.deepEqual(result, { success: true });
  assert.deepEqual(
    fake.requests.slice(before).map((r) => r.path),
    ['/retrieve', '/update'],
  );
  assert.deepEqual(fake.updates, [{ ch_mode_temp: 21 }]);
  assert.equal(fake.requests.at(-1).body.update_message.account_auth.mac_address.length, 17);
  // Not confirmed yet: the shown target is still the one read.
  assert.equal(state(gladys, t, 'target'), 20);
  assert.ok(
    [...pending.values()].some((p) => Math.round(p.at - clock.now) === CONFIRM_AFTER_MS),
    'the confirming read',
  );
  await wait(CONFIRM_AFTER_MS);
  assert.equal(state(gladys, t, 'target'), 21);
  assert.equal(fake.requests.filter((r) => r.path === '/retrieve').length, 3);
  // The loop goes on 60 s after that read, not sooner.
  await wait(MINUTE - SECOND);
  assert.equal(fake.requests.filter((r) => r.path === '/retrieve').length, 3);
  await wait(2 * SECOND);
  assert.equal(fake.requests.filter((r) => r.path === '/retrieve').length, 4);
});

test('room setpoint: values checked before rounding, half degrees, already set = nothing sent', async () => {
  const { gladys, fake } = await boot({ config: ALL });
  const t = thermostat();
  for (const value of [27.2, 3.8, '', null, true, 'abc', NaN]) {
    const result = await set(gladys, t, 'target', value);
    assert.equal(result.success, false, String(value));
    assert.match(result.error, /from 4 to 27 °C/);
  }
  assert.equal(fake.updates.length, 0);
  assert.equal((await set(gladys, t, 'target', '20.3')).success, true);
  assert.deepEqual(fake.updates, [{ ch_mode_temp: 20.5 }]);
  assert.equal((await set(gladys, t, 'target', 27)).success, true);
  assert.equal((await set(gladys, t, 'target', 4)).success, true);
  assert.deepEqual(
    fake.updates.map((u) => u.ch_mode_temp),
    [20.5, 27, 4],
  );
  // Already there (the fresh read says 4): nothing sent, success anyway.
  const before = fake.requests.length;
  assert.equal((await set(gladys, t, 'target', 4.1)).success, true);
  assert.equal(fake.requests.length - before, 1, 'the fresh read only');
  assert.equal(fake.updates.length, 3);
});

test('control mode: Heating (1) and Auto (3) only; ch_control_mode 1 / 0', async () => {
  const { gladys, fake, wait } = await boot({ config: ALL });
  const t = thermostat();
  for (const value of [0, 2, 4]) {
    const result = await set(gladys, t, 'mode', value);
    assert.equal(result.success, false, String(value));
    assert.match(
      result.error,
      /offers Heating \(1\) and Auto \(3\) only, no Off.*lower the room setpoint/,
    );
  }
  for (const value of ['', null, 'heat', '0x1', [1]]) {
    const result = await set(gladys, t, 'mode', value);
    assert.match(result.error, /a number is expected/, String(value));
  }
  assert.equal((await set(gladys, t, 'mode', 1)).success, true);
  assert.deepEqual(fake.updates, [{ ch_control_mode: 1 }]);
  await wait(CONFIRM_AFTER_MS);
  assert.equal(state(gladys, t, 'mode'), 1);
  assert.equal((await set(gladys, t, 'mode', 1)).success, true, 'already there');
  assert.equal(fake.updates.length, 1);
  assert.equal((await set(gladys, t, 'mode', '3')).success, true);
  assert.deepEqual(fake.updates.at(-1), { ch_control_mode: 0 });
});

test('hot water setpoint: the cap of the user (55 by default, 60 at most) and the bounds of the thermostat', async () => {
  const { gladys, fake } = await boot({ config: ALL });
  const b = boiler();
  for (const [value, pattern] of [
    [56, /from 30 to 55 °C/],
    [29, /from 30 to 55 °C/],
    [35, /from 40 to 55 °C/], // the thermostat's dhw_min_set is 40
  ]) {
    const result = await set(gladys, b, 'dhw_target', value);
    assert.equal(result.success, false, String(value));
    assert.match(result.error, pattern);
  }
  assert.equal(fake.updates.length, 0);
  assert.equal((await set(gladys, b, 'dhw_target', 55)).success, true);
  assert.deepEqual(fake.updates, [{ dhw_temp_setp: 55 }]);
});

test('hot water setpoint: a cap of 60 chosen by the user, never above; the thermostat may cap lower', async () => {
  const fake = createFakeThermostat({ dhwMaxSet: 58 });
  const { gladys } = await boot({ config: { ...ALL, dhw_max: 60 }, fake });
  const b = boiler();
  const refused = await set(gladys, b, 'dhw_target', 59);
  assert.equal(refused.success, false);
  assert.match(refused.error, /from 40 to 58 °C/);
  assert.equal((await set(gladys, b, 'dhw_target', 58)).success, true);
  assert.deepEqual(fake.updates, [{ dhw_temp_setp: 58 }]);
  const above = await set(gladys, b, 'dhw_target', 61);
  assert.equal(above.success, false);
  assert.match(above.error, /from 30 to 60 °C/);
});

test('hot water setpoint in Fahrenheit or without the bounds of the thermostat: refused, nothing written', async () => {
  const cases = [
    // temp_unit 1, bounds given in °F: refused (unit not verified).
    [{ tempUnit: 1, dhwMinSet: 104, dhwMaxSet: 149, dhwTempSetp: 122 }, /set to Fahrenheit/],
    // temp_unit 1, bounds missing.
    [{ tempUnit: 1, dhwMinSet: null, dhwMaxSet: null }, /set to Fahrenheit/],
    // temp_unit 1, hot water left in °C (Home Assistant's view), bounds missing.
    [{ tempUnit: 1, dhwMinSet: null, dhwMaxSet: null, dhwTempSetp: 50 }, /set to Fahrenheit/],
    // temp_unit 0, bounds missing: no fallback on the cap any more.
    [{ dhwMinSet: null, dhwMaxSet: null }, /no usable hot water bounds/],
    // temp_unit 0, bounds that are not °C values.
    [{ dhwMinSet: 104, dhwMaxSet: 149 }, /no usable hot water bounds/],
    [{ dhwMinSet: 60, dhwMaxSet: 40 }, /no usable hot water bounds/],
  ];
  for (const [report, pattern] of cases) {
    const fake = createFakeThermostat(report);
    const { gladys, app } = await boot({ config: { ...ALL, dhw_max: 60 }, fake });
    const result = await set(gladys, boiler(), 'dhw_target', 60);
    assert.equal(result.success, false, JSON.stringify(report));
    assert.match(result.error, pattern);
    assert.deepEqual(fake.updates, [], JSON.stringify(report));
    await app.stop();
  }
  // temp_unit 0, bounds given: 60 written.
  const fake = createFakeThermostat({ dhwMaxSet: 65 });
  const { gladys } = await boot({ config: { ...ALL, dhw_max: 60 }, fake });
  assert.equal((await set(gladys, boiler(), 'dhw_target', 60)).success, true);
  assert.deepEqual(fake.updates, [{ dhw_temp_setp: 60 }]);
});

test('the last guard of the client: nothing above 60 for the hot water, known keys, finite numbers', async () => {
  const fake = createFakeThermostat();
  const { app } = await boot({ fake });
  for (const control of [
    { dhw_temp_setp: 61 },
    { dhw_temp_setp: 140 },
    { dhw_temp_setp: NaN },
    { x: 1 },
    {},
  ]) {
    await assert.rejects(
      app.client.update(control),
      (err) => err.code === 'refused' && err.notSent,
    );
  }
  assert.deepEqual(fake.updates, []);
});

test('a thermostat in Fahrenheit gets the room setpoint in Fahrenheit', async () => {
  const fake = createFakeThermostat({ tempUnit: 1, chModeTemp: 68, dhwTempSetp: 122 });
  const { gladys } = await boot({ config: ALL, fake });
  assert.equal((await set(gladys, thermostat(), 'target', 20)).success, true, 'already 68 °F');
  assert.equal(fake.updates.length, 0);
  assert.equal((await set(gladys, thermostat(), 'target', 21)).success, true);
  assert.deepEqual(fake.updates, [{ ch_mode_temp: 69.8 }]);
});

test('too slow: a fresh read past the budget sends nothing and says so', async () => {
  const { gladys, fake, clock } = await boot({ config: ALL });
  let release;
  fake.gate = new Promise((resolve) => {
    release = resolve;
  });
  const promise = set(gladys, thermostat(), 'target', 22);
  await settle();
  clock.now += 3 * SECOND;
  release();
  const result = await promise;
  assert.equal(result.success, false);
  assert.match(result.error, /too slow: nothing sent/);
  assert.equal(fake.updates.length, 0);
});

test('a slow thermostat: Gladys is answered at 4.3 s, "sent, not answered yet", then confirmed', async () => {
  const { gladys, fake, wait, logs } = await boot({ config: ALL });
  let release;
  fake.updateGate = new Promise((resolve) => {
    release = resolve;
  });
  const promise = set(gladys, thermostat(), 'target', 22);
  await settle();
  assert.equal(fake.updates.length, 1, 'sent');
  await wait(COMMAND_ACK_MS);
  assert.deepEqual(await promise, { success: true });
  assert.ok(logs.some((l) => /sent, the thermostat has not answered yet/.test(l)));
  // The update was given the usual 10 s, only its sending bound to 3.5 s.
  const update = fake.requests.find((r) => r.path === '/update');
  assert.equal(update.timeout, 10_000);
  assert.ok(update.sendWithin <= 3500);
  release();
  await settle();
  await wait(CONFIRM_AFTER_MS);
  assert.equal(state(gladys, thermostat(), 'target'), 22);
});

test('another thermostat answering, or the pairing lost: nothing sent', async () => {
  const { gladys, fake, wait } = await boot({ config: ALL });
  fake.deviceId = OTHER_DEVICE_ID;
  const other = await set(gladys, thermostat(), 'target', 22);
  assert.equal(other.success, false);
  assert.match(other.error, /Another thermostat answers/);
  fake.deviceId = DEVICE_ID;
  fake.pending = true;
  const lost = await set(gladys, thermostat(), 'target', 22);
  assert.equal(lost.success, false);
  assert.match(lost.error, /State not read \(pairing not confirmed\)/);
  assert.match(gladys.fake.connectionStatus.message.en, /Confirm the pairing/);
  // Refused before any request while the pairing is not confirmed.
  const before = fake.requests.length;
  const refused = await set(gladys, thermostat(), 'target', 22);
  assert.match(refused.error, /pairing is not confirmed/);
  assert.equal(fake.requests.length, before);
  assert.equal(fake.updates.length, 0);
  await wait(MINUTE);
});

test('the thermostat unreachable or refusing: said, nothing confirmed', async () => {
  const { gladys, fake } = await boot({ config: ALL });
  fake.unreachable = true;
  const down = await set(gladys, thermostat(), 'target', 22);
  assert.equal(down.success, false);
  assert.match(down.error, /State not read \(no connection\): nothing sent/);
  fake.unreachable = false;
  fake.failures.push({ path: '/update', status: 500 });
  const refused = await set(gladys, thermostat(), 'target', 22);
  assert.equal(refused.success, false);
  assert.match(refused.error, /Sent, refused by the thermostat \(HTTP error 500\)/);
});

test('the option unticked between the command and its sending refuses it', async () => {
  const { gladys, fake, app } = await boot({ config: ALL });
  let release;
  fake.gate = new Promise((resolve) => {
    release = resolve;
  });
  const promise = set(gladys, thermostat(), 'target', 22);
  await settle();
  app.config = { ...app.config, allowSetpoint: false };
  release();
  const result = await promise;
  assert.equal(result.success, false);
  assert.match(result.error, /room setpoint is disabled/);
  assert.equal(fake.updates.length, 0);
});

test('an unknown feature is refused', async () => {
  const { gladys } = await boot({ config: ALL });
  const result = await gladys.fake.setValue(thermostat(), { external_id: 'ext:atag:x:y' }, 1);
  assert.equal(result.success, false);
  assert.match(result.error, /Unknown device or feature/);
  const sensor = await set(gladys, thermostat(), 'temperature', 1);
  assert.match(sensor.error, /Unknown device or feature/);
});

test('an update without an answer for 10 s: Gladys answered "sent" at 4.3 s, logged, read again', async () => {
  const { gladys, fake, wait, logs } = await boot({ config: ALL });
  fake.updateGate = new Promise(() => {}); // never answers
  const promise = set(gladys, thermostat(), 'target', 22);
  await settle();
  await wait(COMMAND_ACK_MS);
  assert.deepEqual(await promise, { success: true });
  const reads = fake.requests.filter((r) => r.path === '/retrieve').length;
  await wait(10 * SECOND);
  assert.ok(logs.some((l) => /not confirmed: timeout/.test(l)));
  await wait(CONFIRM_AFTER_MS);
  assert.equal(fake.requests.filter((r) => r.path === '/retrieve').length, reads + 1);
  // Never answered, never applied here: the read tells it.
  assert.match(gladys.fake.connectionStatus.message.en, /last command is not seen/);
});

test('an update sent then cut without an answer: "sent, no answer", never "refused"; logged', async () => {
  const { gladys, fake, app, logs, wait } = await boot({ config: ALL });
  app.request = async (url, options) => {
    if (url.endsWith('/update')) {
      options.onSent?.();
      fake.updates.push(JSON.parse(options.body).update_message.control);
      throw Object.assign(new Error('Connection closed'), { code: 'reset' });
    }
    return fake.request(url, options);
  };
  app.client.request = app.request;
  const result = await set(gladys, thermostat(), 'target', 22);
  assert.equal(result.success, false);
  assert.match(
    result.error,
    /^Sent, no answer from the thermostat \(connection closed by the thermostat\): the read 5 s later tells/,
  );
  assert.ok(logs.some((l) => /Command setpoint failed: reset/.test(l)));
  await wait(CONFIRM_AFTER_MS);
  assert.equal(fake.updates.length, 1, 'never sent twice');
});

test('a 3.6 s update on a real loopback server: Gladys gets success, the value is applied', async () => {
  const fake = createFakeThermostat();
  fake.updateGate = null;
  const server = await fake.listen();
  const gladys = createFakeGladys({
    selector: 'atag',
    config: { host: `127.0.0.1:${server.port}`, allow_setpoint: true },
    devices: [thermostat()],
  });
  const quiet = () => {};
  const app = new AtagApp({
    gladys,
    logger: { info: quiet, warn: quiet, error: quiet, debug: quiet },
    store: memoryStore(),
  });
  registerHandlers(gladys, app, undefined);
  try {
    await gladys.connect();
    while (!app.online) await new Promise((resolve) => setTimeout(resolve, 10));
    // The thermostat takes 3.6 s to answer the update
    // (Gladys answered before 4.3 s): the old cut at 3.5 s after the command killed it.
    fake.updateGate = new Promise((resolve) => setTimeout(resolve, 3600));
    const started = performance.now();
    const result = await set(gladys, thermostat(), 'target', 22);
    assert.deepEqual(result, { success: true });
    assert.ok(performance.now() - started < 4500);
    assert.equal(fake.report.chModeTemp, 22);
  } finally {
    await app.stop();
    await server.close();
  }
});

test('a command right after a saved configuration or a restart is accepted on its fresh read', async () => {
  const { gladys, fake, app } = await boot();
  // The user ticks the option and saves: no read is due for 60 s.
  await gladys.fake.configUpdated({ host: '192.168.1.20', allow_setpoint: true });
  const result = await set(gladys, thermostat(), 'target', 21);
  assert.deepEqual(result, { success: true });
  assert.deepEqual(fake.updates, [{ ch_mode_temp: 21 }]);
  await app.stop();
  // A restart (a new app, the same /data): the pairing state unknown, the
  // command reads and proceeds.
  const store = memoryStore({
    mac: '02-11-22-33-44-55',
    lastAttemptAt: Date.now(),
    pair: { failures: 0, nextAt: 0 },
  });
  const world = await boot({ config: ALL, store, fake });
  assert.equal(world.app.authorized, null);
  assert.deepEqual(await set(world.gladys, thermostat(), 'target', 23), { success: true });
  // Not paired after all: the fresh read says it, with the true reason.
  fake.pending = true;
  const refused = await set(world.gladys, thermostat(), 'target', 24);
  assert.match(refused.error, /State not read \(pairing not confirmed\)/);
});

test('command values: a number or a plain decimal string only', async () => {
  const { gladys, fake } = await boot({ config: ALL });
  for (const value of ['0x14', '0b10101', [21], '2e1', '\t23\n', ' 21', '21.', '+21']) {
    const result = await set(gladys, thermostat(), 'target', value);
    assert.equal(result.success, false, JSON.stringify(value));
  }
  assert.equal(fake.updates.length, 0);
  assert.equal((await set(gladys, thermostat(), 'target', '21.5')).success, true);
  assert.deepEqual(fake.updates, [{ ch_mode_temp: 21.5 }]);
});

test('the confirming read compares: a value not applied is logged and said in the status', async () => {
  const { gladys, fake, wait, logs, app } = await boot({ config: ALL });
  app.client.request = async (url, options) => {
    const answer = await fake.request(url, options);
    if (url.endsWith('/update')) fake.report.chModeTemp = 20; // the thermostat ignores it
    return answer;
  };
  assert.equal((await set(gladys, thermostat(), 'target', 22)).success, true);
  await wait(CONFIRM_AFTER_MS);
  assert.ok(logs.some((l) => /Command setpoint not seen at the confirming read/.test(l)));
  assert.match(
    gladys.fake.connectionStatus.message.en,
    /last command is not seen on the thermostat/,
  );
  await wait(MINUTE);
  assert.doesNotMatch(gladys.fake.connectionStatus.message.en, /last command/);
});

test('at most 6 updates of a kind per minute (a scene in a loop)', async () => {
  const { gladys, fake, wait } = await boot({ config: ALL });
  for (let i = 0; i < 6; i += 1) {
    assert.equal((await set(gladys, thermostat(), 'target', 10 + i)).success, true);
    await wait(2 * SECOND);
  }
  const refused = await set(gladys, thermostat(), 'target', 20);
  assert.match(refused.error, /at most 6 commands of this kind per minute/);
  assert.equal(fake.updates.length, 6);
  // Another kind is not held back.
  assert.equal((await set(gladys, thermostat(), 'mode', 1)).success, true);
  await wait(MINUTE);
  assert.equal((await set(gladys, thermostat(), 'target', 20)).success, true);
});
