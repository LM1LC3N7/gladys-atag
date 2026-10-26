// -----------------------------------------------------------------------------
// The thermostat client: the messages of pyatag, one request at a time one
// second apart, the deadline of a command, the pairing refused, the resets
// tried again for reads only.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ThermostatClient, USER_AGENT } from '../src/atag/client.js';
import { CODES } from '../src/atag/errors.js';
import { createFakeThermostat, retrieveReply } from './helpers/fakeThermostat.js';

const MAC = '02-11-22-33-44-55';

function client(fake, { now = 0 } = {}) {
  const clock = { now };
  const sleeps = [];
  const c = new ThermostatClient({
    origin: 'http://192.168.1.20:10000',
    mac: MAC,
    request: fake.request,
    monotonic: () => (clock.now += 0.001),
    sleep: async (ms) => {
      sleeps.push(ms);
      clock.now += ms;
    },
  });
  return { c, clock, sleeps };
}

test('pair, retrieve and update carry the identity; one second between two requests', async () => {
  const fake = createFakeThermostat();
  const { c, sleeps } = client(fake);
  await c.pair();
  const report = await c.retrieve();
  await c.update({ ch_mode_temp: 21 });
  assert.deepEqual(
    fake.requests.map((r) => r.path),
    ['/pair', '/retrieve', '/update'],
  );
  assert.equal(fake.requests[0].body.pair_message.account_auth.mac_address, MAC);
  assert.equal(fake.requests[1].body.retrieve_message.info, 71);
  assert.deepEqual(fake.requests[2].body.update_message.control, { ch_mode_temp: 21 });
  assert.deepEqual(fake.requests[2].body.update_message.configuration, {});
  for (const r of fake.requests) assert.equal(r.headers['user-agent'], USER_AGENT);
  assert.doesNotMatch(USER_AGENT, /Mozilla|AtagOneAPI|OneApp/i, 'never the identity of an app');
  assert.equal(sleeps.length, 2, 'the second and third requests waited');
  assert.ok(sleeps.every((ms) => ms > 999 && ms <= 1000));
  assert.equal(report.deviceId, fake.deviceId);
  assert.equal(report.roomTemperature, 20.5);
});

test('the pairing not confirmed is UNAUTHORIZED, with the acc_status', async () => {
  const fake = createFakeThermostat();
  fake.pending = true;
  const { c } = client(fake);
  await assert.rejects(c.pair(), (err) => err.code === CODES.UNAUTHORIZED && err.accStatus === 3);
  await assert.rejects(c.retrieve(), (err) => err.code === CODES.UNAUTHORIZED);
});

test('a reset is tried again for a read (3 tries), never for an update', async () => {
  const fake = createFakeThermostat();
  const { c } = client(fake);
  fake.resets = 2;
  await c.retrieve();
  assert.equal(fake.requests.length, 3);
  fake.resets = 3;
  await assert.rejects(c.retrieve(), (err) => err.code === CODES.RESET);
  fake.resets = 1;
  await assert.rejects(c.update({ ch_mode_temp: 20 }), (err) => err.code === CODES.RESET);
  assert.equal(fake.updates.length, 0);
});

test('a deadline: the request gets the time left, none left = not sent', async () => {
  const fake = createFakeThermostat();
  const { c, clock } = client(fake, { now: 10_000 });
  await c.retrieve({ deadline: 12_000 });
  assert.ok(fake.requests[0].timeout <= 2000 && fake.requests[0].timeout > 1990);
  assert.ok(fake.requests[0].sendWithin <= 2000);
  // The next request waits 1 s: with 1.2 s left, 0.2 s would remain: not sent.
  await assert.rejects(
    c.update({ ch_mode_temp: 20 }, { deadline: clock.now + 1200 }),
    (err) => err.code === CODES.NO_TIME && err.notSent === true,
  );
  assert.equal(fake.updates.length, 0);
  await assert.rejects(
    c.update({ ch_mode_temp: 20 }, { deadline: clock.now + 100 }),
    (err) => err.code === CODES.NO_TIME && err.notSent === true,
  );
});

test('odd answers: an HTTP error, not JSON, the wrong reply, no report', async () => {
  const fake = createFakeThermostat();
  const { c } = client(fake);
  fake.failures.push({ path: '/retrieve', status: 500 });
  await assert.rejects(c.retrieve(), (err) => err.code === CODES.HTTP && err.status === 500);
  fake.rawBody = 'not json';
  await assert.rejects(c.retrieve(), (err) => err.code === CODES.BAD_ANSWER);
  fake.rawBody = JSON.stringify({ pair_reply: { acc_status: 2 } });
  await assert.rejects(c.retrieve(), (err) => err.code === CODES.BAD_ANSWER);
  fake.rawBody = JSON.stringify({ retrieve_reply: { acc_status: 2, status: {} } });
  await assert.rejects(c.retrieve(), (err) => err.code === CODES.BAD_ANSWER);
  fake.rawBody = JSON.stringify(retrieveReply());
  assert.equal((await c.retrieve()).roomTemperature, 20.5);
});

test('a closed client sends nothing', async () => {
  const fake = createFakeThermostat();
  const { c } = client(fake);
  c.close();
  await assert.rejects(c.retrieve(), (err) => err.code === CODES.CLOSED && err.notSent);
  assert.equal(fake.requests.length, 0);
});
