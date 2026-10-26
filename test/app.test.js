// -----------------------------------------------------------------------------
// The integration against the SDK's fake Gladys and the fake thermostat,
// through the exact wiring of the container (src/handlers.js), on a virtual
// clock that moves at every read of it.
// -----------------------------------------------------------------------------

import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { INTERVALS } from '../src/constants.js';
import { memoryStore } from '../src/store.js';
import {
  HOUR,
  MAC,
  MINUTE,
  SECOND,
  SELECTOR,
  T0,
  badge,
  boiler,
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

const okStatus = {
  connected: true,
  message: {
    en: `The thermostat ${DEVICE_ID} answers.`,
    fr: `Le thermostat ${DEVICE_ID} répond.`,
  },
};

test('start: the report first (already paired: no pairing request); Discovery, states, badges, status', async () => {
  const { gladys, fake, pending, store } = await boot();
  assert.deepEqual(
    fake.requests.map((r) => r.path),
    ['/retrieve'],
  );
  // Our own identity, drawn once and kept in /data; never that of an app.
  assert.equal(fake.requests[0].body.retrieve_message.account_auth.mac_address, MAC);
  assert.match(fake.requests[0].headers['user-agent'], /^gladys-atag /);
  assert.equal(store.data.mac, MAC);
  assert.deepEqual(gladys.fake.connectionStatus, okStatus);
  assert.deepEqual(
    gladys.fake.discoveredDevices.map((d) => [d.external_id, d.name]),
    [
      [`ext:${SELECTOR}:thermostat:${DEVICE_ID}`, `Thermostat Atag One ${DEVICE_ID}`],
      [`ext:${SELECTOR}:boiler:${DEVICE_ID}`, `Chaudière Atag ${DEVICE_ID}`],
    ],
  );
  const t = thermostat();
  const b = boiler();
  assert.equal(state(gladys, t, 'temperature'), 20.5);
  assert.equal(state(gladys, t, 'target'), 20);
  assert.equal(state(gladys, t, 'mode'), 3, 'ch_control_mode 0 is Auto (3)');
  assert.equal(state(gladys, t, 'heating'), 0);
  assert.equal(state(gladys, t, 'program'), 'Programme');
  assert.equal(state(gladys, t, 'outside_temp'), 15);
  assert.equal(state(gladys, t, 'outside_avg'), 12);
  assert.equal(state(gladys, t, 'weather'), 'Éclaircies');
  assert.equal(state(gladys, b, 'ch_water_temp'), 40);
  assert.equal(state(gladys, b, 'ch_return_temp'), 35);
  assert.equal(state(gladys, b, 'pressure'), 1.8);
  assert.equal(state(gladys, b, 'burner'), 0);
  assert.equal(state(gladys, b, 'flame'), 0);
  assert.equal(state(gladys, b, 'dhw_water_temp'), 30);
  assert.equal(state(gladys, b, 'dhw_target'), 50);
  assert.equal(state(gladys, b, 'dhw_heating'), 0);
  assert.equal(state(gladys, b, 'dhw_mode'), 'Éco');
  assert.equal(state(gladys, b, 'burning_hours'), 1000);
  assert.equal(state(gladys, b, 'status'), 'Veille');
  assert.equal(badge(gladys, t).transport, 'local');
  assert.equal(badge(gladys, b).transport, 'local');
  assert.equal(pending.size, 1, 'one timer: the next read');
});

test('the readings follow the thermostat: burner, heating, hot water, mode, program', async () => {
  const { gladys, fake, wait } = await boot();
  fake.report = {
    boilerStatus: 8 | 2,
    relModLevel: 42.5,
    chControlMode: 1,
    chMode: 3,
    chModeTemp: 18.5,
    roomTemp: 19.3,
    weatherStatus: 11,
    dhwMode: 0,
    reportTime: 843_000_060,
  };
  await wait(INTERVALS.POLL_MS);
  const t = thermostat();
  const b = boiler();
  assert.equal(state(gladys, b, 'burner'), 1);
  assert.equal(state(gladys, t, 'heating'), 1);
  assert.equal(state(gladys, b, 'status'), 'Chauffage');
  assert.equal(state(gladys, b, 'flame'), 42.5);
  assert.equal(state(gladys, t, 'mode'), 1);
  assert.equal(state(gladys, t, 'program'), 'Vacances');
  assert.equal(state(gladys, t, 'target'), 18.5);
  assert.equal(state(gladys, t, 'temperature'), 19.3);
  assert.equal(state(gladys, t, 'weather'), 'Orage');
  assert.equal(state(gladys, b, 'dhw_mode'), 'Confort');
  fake.report = { boilerStatus: 8 | 4, reportTime: 843_000_120 };
  await wait(INTERVALS.POLL_MS);
  assert.equal(state(gladys, b, 'dhw_heating'), 1);
  assert.equal(state(gladys, b, 'status'), 'Eau chaude');
  fake.report = { boilerStatus: 8 | 4 | 2, reportTime: 843_000_180 };
  await wait(INTERVALS.POLL_MS);
  assert.equal(state(gladys, b, 'status'), 'Chauffage et eau chaude');
  // Never a pairing request while paired; one retrieve per minute.
  assert.equal(fake.requests.filter((r) => r.path === '/pair').length, 0);
  assert.equal(fake.requests.filter((r) => r.path === '/retrieve').length, 4);
});

test('a thermostat in Fahrenheit: temperatures published in Celsius, hot water not published', async () => {
  const fake = createFakeThermostat({
    tempUnit: 1,
    roomTemp: 68,
    chModeTemp: 66.2,
    outsideTemp: 50,
    dhwTempSetp: 122,
    chWaterTemp: 104,
  });
  const { gladys } = await boot({ fake });
  const t = thermostat();
  const b = boiler();
  assert.equal(state(gladys, t, 'temperature'), 20);
  assert.equal(state(gladys, t, 'target'), 19);
  assert.equal(state(gladys, t, 'outside_temp'), 10);
  assert.equal(state(gladys, b, 'dhw_target'), undefined, 'unit of the hot water not verified');
  assert.equal(state(gladys, b, 'dhw_water_temp'), undefined);
  assert.equal(state(gladys, b, 'ch_water_temp'), 40);
});

test('the pace: the loop reads every 60 s, never sooner; a reconnection republishes without reading', async () => {
  const { gladys, fake, wait, clock } = await boot();
  const reads = () => fake.requests.filter((r) => r.path === '/retrieve').length;
  assert.equal(reads(), 1);
  await wait(INTERVALS.POLL_MS - 5 * SECOND);
  assert.equal(reads(), 1);
  await wait(5 * SECOND);
  assert.equal(reads(), 2);
  // Gladys goes away and comes back: everything is published again, no read.
  const states = gladys.fake.states.length;
  await gladys.disconnect();
  await gladys.connect();
  await wait(0);
  assert.equal(reads(), 2);
  assert.ok(gladys.fake.states.length > states, 'the states are published again');
  assert.deepEqual(gladys.fake.connectionStatus, okStatus);
  assert.equal(gladys.fake.discoveredDevices.length, 2);
  // The next read keeps its planned time (60 s after the last one).
  await wait(INTERVALS.POLL_MS - 2 * SECOND);
  assert.equal(reads(), 2);
  await wait(2 * SECOND);
  assert.equal(reads(), 3);
  assert.ok(clock.now > 0);
});

test('a restart reads no sooner than 60 s after the read kept in /data; the identity is kept', async () => {
  const store = memoryStore({
    mac: '02-AA-BB-CC-DD-EE',
    lastAttemptAt: Date.parse('2026-10-25T08:00:00Z') - 20 * SECOND,
    pair: { failures: 0, nextAt: 0 },
  });
  const { fake, wait, pending } = await boot({ store });
  assert.equal(fake.requests.length, 0, 'nothing read yet');
  assert.equal(pending.size, 1);
  await wait(39 * SECOND);
  assert.equal(fake.requests.length, 0);
  await wait(SECOND);
  assert.deepEqual(
    fake.requests.map((r) => r.path),
    ['/retrieve'],
  );
  assert.equal(
    fake.requests[0].body.retrieve_message.account_auth.mac_address,
    '02-AA-BB-CC-DD-EE',
  );
});

test('pairing pending: asked again 1, 2, 4, 8, 15 min, then no more (8 requests); kept in /data', async () => {
  const fake = createFakeThermostat();
  fake.pending = true;
  const { gladys, wait, store } = await boot({ fake });
  const pairs = () => fake.requests.filter((r) => r.path === '/pair').length;
  assert.deepEqual(
    fake.requests.map((r) => r.path),
    ['/retrieve', '/pair'],
    'the report first, a pairing request on its refusal',
  );
  assert.deepEqual(gladys.fake.connectionStatus, {
    connected: false,
    message: {
      en: 'Confirm the pairing of "Gladys" on the screen of the thermostat. Asked again in 1 min.',
      fr: 'Confirmez l’appairage de « Gladys » sur l’écran du thermostat. Nouvelle demande dans 1 min.',
    },
  });
  assert.equal(badge(gladys, thermostat()).transport, 'unreachable');
  assert.equal(store.data.pair.failures, 1);
  await wait(MINUTE);
  assert.equal(pairs(), 2);
  await wait(MINUTE);
  assert.equal(pairs(), 2, 'the second wait is 2 min');
  await wait(MINUTE);
  assert.equal(pairs(), 3);
  assert.match(gladys.fake.connectionStatus.message.en, /Asked again in 4 min/);
  // 24 hours without a confirmation: 8 requests at most, then the status says
  // how to send one again.
  for (let i = 0; i < 24 * 4; i += 1) await wait(15 * MINUTE);
  assert.equal(pairs(), 8);
  assert.equal(store.data.pair.failures, 8);
  assert.match(
    gladys.fake.connectionStatus.message.en,
    /no more automatic requests.*Test the connection/,
  );
  const retrieves = fake.requests.filter((r) => r.path === '/retrieve').length;
  assert.ok(retrieves >= 20 && retrieves <= 26, `a plain read an hour, no request: ${retrieves}`);
});

test('pairing requests spent: a restart does not reset them; the button sends one', async () => {
  const fake = createFakeThermostat();
  fake.pending = true;
  const store = memoryStore({
    mac: MAC,
    lastAttemptAt: T0 - HOUR,
    pair: { failures: 8, nextAt: 0 },
  });
  const { gladys, wait } = await boot({ fake, store });
  const pairs = () => fake.requests.filter((r) => r.path === '/pair').length;
  assert.deepEqual(
    fake.requests.map((r) => r.path),
    ['/retrieve'],
    'one read after the restart, no pairing request',
  );
  assert.match(gladys.fake.connectionStatus.message.en, /no more automatic requests/);
  await wait(HOUR);
  assert.deepEqual(
    fake.requests.map((r) => r.path),
    ['/retrieve', '/retrieve'],
    'a plain read an hour, never a pairing request by itself',
  );
  await wait(MINUTE); // the button keeps the pace too
  const result = await gladys.fake.action('test_connection', {});
  assert.equal(result.success, false);
  assert.equal(pairs(), 1, 'the button sent one');
  assert.match(gladys.fake.connectionStatus.message.en, /Asked again in 1 min/);
  fake.pending = false;
  await wait(MINUTE);
  assert.deepEqual(gladys.fake.connectionStatus, okStatus);
  assert.equal(store.data.pair.failures, 0);
});

test('"Test the connection" pairs again when a read is due, and never reads sooner than the pace', async () => {
  const fake = createFakeThermostat();
  fake.pending = true;
  const { gladys, wait } = await boot({ fake });
  const pairs = () => fake.requests.filter((r) => r.path === '/pair').length;
  const reads = () => fake.requests.filter((r) => r.path === '/retrieve').length;
  await wait(MINUTE);
  await wait(MINUTE);
  assert.equal(pairs(), 2, 'at 0 and 60 s; the next one at 180 s');
  assert.match(gladys.fake.connectionStatus.message.en, /Asked again in 2 min/);
  // Confirmed on the screen, the user presses the button at 150 s: the last
  // request was 90 s ago, the pace allows a read now; the backoff is lifted.
  fake.pending = false;
  await wait(30 * SECOND);
  const now = await gladys.fake.action('test_connection', {});
  assert.equal(now.success, true, now.error);
  assert.equal(pairs(), 3);
  assert.equal(reads(), 2, 'the refused one at start, then this one');
  assert.deepEqual(gladys.fake.connectionStatus, okStatus);
  // 10 s later (the pairing and the report were 1 s apart): the button
  // answers from the last read, no new read.
  await wait(10 * SECOND);
  const result = await gladys.fake.action('test_connection', {});
  assert.deepEqual(result, {
    success: true,
    data: {
      message: {
        en: `The thermostat ${DEVICE_ID} answers (last read 11 s ago).`,
        fr: `Le thermostat ${DEVICE_ID} répond (dernière lecture il y a 11 s).`,
      },
    },
  });
  assert.equal(reads(), 2);
  // The loop reads at 210 s and finds the thermostat down; the button at
  // 230 s does not read sooner than 60 s after that (the retry is lifted).
  fake.unreachable = true;
  await wait(50 * SECOND + 1);
  assert.equal(reads(), 3);
  await wait(20 * SECOND);
  const early = await gladys.fake.action('test_connection', {});
  assert.equal(early.success, false);
  assert.match(early.error, /does not answer \(no connection\).*next read in (39|40) s/);
  assert.equal(reads(), 3);
  fake.unreachable = false;
  await wait(40 * SECOND);
  assert.equal(reads(), 4);
  const due = await gladys.fake.action('test_connection', {});
  assert.equal(due.success, true);
  assert.equal(reads(), 4, 'just read: not again');
});

test('the pairing lost on a report (acc_status 3) goes back to the pairing', async () => {
  const { gladys, fake, wait } = await boot();
  fake.pending = true;
  await wait(INTERVALS.POLL_MS);
  assert.match(gladys.fake.connectionStatus.message.en, /Confirm the pairing/);
  assert.equal(badge(gladys, boiler()).transport, 'unreachable');
  assert.deepEqual(
    fake.requests.slice(-2).map((r) => r.path),
    ['/retrieve', '/pair'],
  );
  fake.pending = false;
  await wait(MINUTE);
  assert.deepEqual(
    fake.requests.slice(-2).map((r) => r.path),
    ['/pair', '/retrieve'],
  );
  assert.deepEqual(gladys.fake.connectionStatus, okStatus);
});

test('thermostat unreachable: retried 1, 2, 4... min up to 10, devices unreachable, no pace shorter than 60 s', async () => {
  const { gladys, fake, wait, logs } = await boot();
  fake.unreachable = true;
  await wait(INTERVALS.POLL_MS);
  assert.deepEqual(gladys.fake.connectionStatus, {
    connected: false,
    message: {
      en: 'The thermostat does not answer (no connection). Retried in 1 min.',
      fr: 'Le thermostat ne répond pas (pas de connexion). Nouvel essai dans 1 min.',
    },
  });
  assert.equal(badge(gladys, thermostat()).transport, 'unreachable');
  const tries = () => fake.requests.filter((r) => r.path === '/retrieve').length;
  const before = tries();
  await wait(MINUTE);
  assert.equal(tries(), before + 1);
  await wait(MINUTE);
  assert.equal(tries(), before + 1, '2 min now');
  await wait(MINUTE);
  assert.equal(tries(), before + 2);
  for (let i = 0; i < 4; i += 1) await wait(10 * MINUTE);
  assert.match(gladys.fake.connectionStatus.message.en, /Retried in 10 min/);
  assert.ok(logs.some((l) => /The thermostat fails: unreachable/.test(l)));
  assert.ok(!logs.some((l) => /fails:/.test(l) && /192\.168/.test(l)), 'no address in a failure');
  fake.unreachable = false;
  await wait(10 * MINUTE);
  assert.deepEqual(gladys.fake.connectionStatus, okStatus);
  assert.equal(badge(gladys, thermostat()).transport, 'local');
});

test('a connection the thermostat closes is tried again (3 tries), never an update', async () => {
  const { gladys, fake, wait } = await boot();
  fake.resets = 2;
  await wait(INTERVALS.POLL_MS);
  assert.deepEqual(gladys.fake.connectionStatus, okStatus);
  fake.resets = 3;
  await wait(INTERVALS.POLL_MS);
  assert.match(gladys.fake.connectionStatus.message.en, /connection closed by the thermostat/);
});

test('not an Atag One at this address: said; a huge or odd answer never crashes', async () => {
  const { gladys, fake, wait } = await boot();
  fake.rawBody = '<html>a web page</html>';
  await wait(INTERVALS.POLL_MS);
  assert.match(gladys.fake.connectionStatus.message.en, /does not answer like an Atag One/);
  fake.rawBody = JSON.stringify({ retrieve_reply: { acc_status: 2, report: 'x', control: {} } });
  await wait(MINUTE);
  assert.match(gladys.fake.connectionStatus.message.en, /does not answer like an Atag One/);
  fake.rawBody = JSON.stringify({
    retrieve_reply: { acc_status: 2, status: {}, report: {}, control: {} },
  });
  await wait(2 * MINUTE);
  assert.match(gladys.fake.connectionStatus.message.en, /does not answer like an Atag One/);
  fake.rawBody = null;
  await wait(4 * MINUTE);
  assert.deepEqual(gladys.fake.connectionStatus, okStatus);
});

test('another thermostat at the address: the created devices unreachable, the new one in Discovery', async () => {
  const { gladys, fake, wait } = await boot();
  fake.deviceId = OTHER_DEVICE_ID;
  fake.report = { roomTemp: 25, reportTime: 843_000_060 };
  await wait(INTERVALS.POLL_MS);
  assert.equal(badge(gladys, thermostat()).transport, 'unreachable');
  assert.equal(state(gladys, thermostat(), 'temperature'), 20.5, 'nothing of the other one');
  assert.equal(
    gladys.fake.discoveredDevices[0].external_id,
    `ext:${SELECTOR}:thermostat:${OTHER_DEVICE_ID}`,
  );
  assert.match(gladys.fake.connectionStatus.message.en, new RegExp(OTHER_DEVICE_ID));
});

test('freshness: a report whose own time stops for 2 h is not published, the badge degraded', async () => {
  const { gladys, fake, wait } = await boot();
  const count = () => gladys.fake.states.length;
  fake.report = { roomTemp: 21, reportTime: 843_000_000 }; // the same stamp as at start
  for (let i = 0; i < 125; i += 1) await wait(MINUTE);
  const published = count();
  assert.match(gladys.fake.connectionStatus.message.en, /has not moved for more than 2 hours/);
  assert.equal(badge(gladys, thermostat()).transport, 'local');
  assert.equal(badge(gladys, thermostat()).degraded, true);
  fake.report = { roomTemp: 22, reportTime: 843_000_000 };
  await wait(MINUTE);
  assert.equal(count(), published, 'nothing published while stale');
  assert.equal(state(gladys, thermostat(), 'temperature'), 21);
  fake.report = { roomTemp: 22, reportTime: 843_010_000 };
  await wait(MINUTE);
  assert.equal(state(gladys, thermostat(), 'temperature'), 22);
  assert.deepEqual(gladys.fake.connectionStatus, okStatus);
  assert.equal(badge(gladys, thermostat()).degraded, undefined);
});

test('configuration problems are said, nothing is read', async () => {
  for (const [config, pattern] of [
    [{ host: '' }, /Enter the address/],
    [{ host: 'https://192.168.1.20' }, /no https/],
    [{ host: 'http://user:pw@192.168.1.20' }, /user name or a password/],
    [{ host: '192.168.1.20/path' }, /not valid/],
    [{ dhw_max: 70 }, /from 30 to 60 °C: 55 °C is used/],
    [{ dhw_max: 'abc' }, /55 °C is used/],
  ]) {
    const { gladys, fake, app } = await boot({ config });
    assert.equal(gladys.fake.connectionStatus.connected, false, JSON.stringify(config));
    assert.match(gladys.fake.connectionStatus.message.en, pattern);
    assert.equal(fake.requests.length, 0);
    await app.stop();
  }
});

test('a new configuration (saved) uses a new client at once and keeps the identity', async () => {
  const { gladys, fake, wait, store, app } = await boot();
  const other = createFakeThermostat({ roomTemp: 23, reportTime: 843_000_500 });
  // The new address answers from the second fake: swap the transport.
  app.request = (url, options) =>
    url.includes('192.168.1.30') ? other.request(url, options) : fake.request(url, options);
  await gladys.fake.configUpdated({ host: '192.168.1.30:10000', language: 'en' });
  await wait(0);
  // A user action, but no read sooner than the pace.
  assert.equal(other.requests.length, 0);
  await wait(MINUTE);
  assert.deepEqual(
    other.requests.map((r) => r.path),
    ['/retrieve'],
  );
  assert.equal(other.requests[0].body.retrieve_message.account_auth.mac_address, store.data.mac);
  assert.equal(state(gladys, thermostat(), 'temperature'), 23);
  assert.equal(gladys.fake.discoveredDevices[0].name, `Atag One thermostat ${DEVICE_ID}`);
});

test('/data unwritable: it works, one warning, the status says a restart will ask the pairing', async () => {
  const store = memoryStore(null, { failing: true });
  const { gladys, logs } = await boot({ store });
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.match(gladys.fake.connectionStatus.message.en, /cannot be written: a restart will ask/);
  assert.equal(logs.filter((l) => /\/data not written/.test(l)).length, 1);
});

test('/data unreadable: the file kept, nothing sent to the thermostat, said; read again every minute', async () => {
  const kept = {
    mac: '02-AA-BB-CC-DD-EE',
    lastAttemptAt: T0 - HOUR,
    pair: { failures: 0, nextAt: 0 },
  };
  const store = memoryStore(kept, { unreadable: true });
  const { gladys, fake, wait, logs } = await boot({ store, config: { allow_setpoint: true } });
  assert.equal(fake.requests.length, 0, 'no pairing with a new identity');
  assert.deepEqual(store.data, kept, 'the paired identity is not rewritten');
  assert.equal(store.saves, 0);
  assert.match(gladys.fake.connectionStatus.message.en, /\/data\) cannot be read/);
  assert.equal(logs.filter((l) => /\/data not readable \(EACCES\)/.test(l)).length, 1);
  const command = await gladys.fake.setValue(thermostat(), thermostat().features[1], 21);
  assert.match(command.error, /\/data\) cannot be read: nothing sent/);
  await wait(MINUTE);
  assert.equal(store.loads, 2, 'read again');
  assert.equal(fake.requests.length, 0);
  store.unreadable = false;
  await wait(MINUTE);
  assert.deepEqual(
    fake.requests.map((r) => r.path),
    ['/retrieve'],
  );
  assert.equal(fake.requests[0].body.retrieve_message.account_auth.mac_address, kept.mac);
  assert.deepEqual(gladys.fake.connectionStatus, okStatus);
});

test('/data without a file: a fresh identity drawn and written at once', async () => {
  const store = memoryStore(null);
  await boot({ store });
  assert.equal(store.data.mac, MAC);
});

test('/data with a file but no identity in it: not rewritten', async () => {
  const store = memoryStore({ lastAttemptAt: 1 });
  const { fake, gladys } = await boot({ store });
  assert.deepEqual(store.data, { lastAttemptAt: 1 });
  assert.equal(fake.requests.length, 0);
  assert.match(gladys.fake.connectionStatus.message.en, /cannot be read/);
});

test('the configuration of Gladys not read: asked again without end, said, then the reads start', async () => {
  const { app, gladys, fake, wait } = await boot({ connect: false });
  let failures = 6;
  let calls = 0;
  const getConfig = gladys.getConfig.bind(gladys);
  gladys.getConfig = async () => {
    calls += 1;
    // The first call is the resynchronization of the SDK's connect().
    if (calls > 1 && failures > 0) {
      failures -= 1;
      throw new Error('Gladys busy');
    }
    return getConfig();
  };
  await gladys.connect();
  await wait(0);
  assert.equal(fake.requests.length, 0);
  assert.match(gladys.fake.connectionStatus.message.en, /configuration of Gladys is not read yet/);
  // The button gives the real cause.
  const pressed = await gladys.fake.action('test_connection', {});
  assert.match(pressed.error, /configuration of Gladys could not be read/);
  // 30 s, 1, 2, 4, 8 min, then 10 min (the button used one failure).
  for (let i = 0; i < 5; i += 1) await wait(10 * MINUTE);
  assert.ok(fake.requests.length > 0, 'the reads started');
  assert.deepEqual(gladys.fake.connectionStatus, okStatus);
  assert.ok(app.running);
});

test('Gladys away 3 h: no old value republished as new at its return', async () => {
  const { gladys, fake, wait, app } = await boot();
  const t = thermostat();
  await gladys.disconnect();
  await wait(3 * HOUR);
  fake.report = { roomTemp: 15, reportTime: 843_010_000 };
  const published = [];
  const publish = gladys.publishChangedStates.bind(gladys);
  gladys.publishChangedStates = async (states, options) => {
    published.push(...states);
    return publish(states, options);
  };
  await gladys.connect();
  await wait(0);
  const room = published
    .filter((p) => p.device_feature_external_id.endsWith(':temperature'))
    .map((p) => p.state);
  assert.deepEqual(room, [15], 'the 20.5 of 3 h ago is not published, the fresh read is');
  assert.ok(app.running);
  assert.ok(t);
});

test('the Discovery button publishes what is known without a read', async () => {
  const { gladys, fake } = await boot();
  const reads = fake.requests.length;
  await gladys.fake.scanRequest();
  assert.equal(fake.requests.length, reads);
  assert.equal(gladys.fake.discoveredDevices.length, 2);
});

test('the state budget: a burst is cut and rotates, nothing lost over time', async () => {
  const { app } = await boot();
  app.publisher.budget.entries = [];
  app.publisher.budget.record(240);
  const list = Array.from({ length: 30 }, (_, i) => ({
    device_feature_external_id: `ext:${SELECTOR}:thermostat:${DEVICE_ID}:f${i}`,
    state: i,
  }));
  const sent = [];
  app.gladys.publishChangedStates = async (states) => {
    sent.push(states.map((s) => s.state));
    return { success: true, count: states.length };
  };
  await app.publisher.publish(list);
  assert.deepEqual(sent[0], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  app.publisher.budget.entries = [];
  app.publisher.budget.record(240);
  await app.publisher.publish(list);
  assert.deepEqual(sent[1], [10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
});

test('stop writes /data and clears the timers', async () => {
  const { app, pending, store, wait } = await boot();
  await wait(30 * SECOND);
  store.data.lastAttemptAt = 0; // as if the save at the read had been lost
  await app.stop();
  assert.equal(pending.size, 0);
  assert.equal(store.data.lastAttemptAt, T0, 'the time of the read, written at the stop');
  assert.ok(HOUR > 0);
});

test('freshness kept across a restart: a thermostat stuck before the restart is not published 2 h more', async () => {
  const store = memoryStore({
    mac: MAC,
    lastAttemptAt: T0 - 2 * MINUTE,
    pair: { failures: 0, nextAt: 0 },
    report: { time: 843_000_000, changedAt: T0 - 3 * HOUR },
  });
  const { gladys } = await boot({ store });
  assert.equal(state(gladys, thermostat(), 'temperature'), undefined);
  assert.match(gladys.fake.connectionStatus.message.en, /has not moved for more than 2 hours/);
});

test('every read writes its time to /data, before the request', async () => {
  const { store, wait, clock } = await boot();
  await wait(MINUTE);
  assert.ok(Math.abs(store.data.lastAttemptAt - (clock.now - 0)) < 2 * SECOND);
  assert.equal(store.data.report.time, 843_000_000);
});

test('an HTTP error is told as an answer, not as silence', async () => {
  const { gladys, fake, wait } = await boot();
  fake.failures.push({ path: '/retrieve', status: 503 });
  await wait(MINUTE);
  assert.match(gladys.fake.connectionStatus.message.en, /answers with HTTP error 503/);
});

test('pairing requests spent, then confirmed late on the screen: the hourly read sees it', async () => {
  const fake = createFakeThermostat();
  fake.pending = true;
  const store = memoryStore({
    mac: MAC,
    lastAttemptAt: T0 - HOUR,
    pair: { failures: 8, nextAt: 0 },
  });
  const { gladys, wait } = await boot({ fake, store });
  assert.match(gladys.fake.connectionStatus.message.en, /no more automatic requests/);
  fake.pending = false; // confirmed on the screen (an earlier request) later on
  await wait(HOUR);
  assert.deepEqual(gladys.fake.connectionStatus, okStatus);
  assert.equal(fake.requests.filter((r) => r.path === '/pair').length, 0);
  assert.equal(store.data.pair.failures, 0);
  // Back to the normal pace.
  await wait(MINUTE);
  assert.equal(fake.requests.filter((r) => r.path === '/retrieve').length, 3);
});

test('a room setpoint set on the thermostat outside 4-27 °C is still shown', async () => {
  const { gladys, fake, wait } = await boot();
  fake.report = { chModeTemp: 28, reportTime: 843_000_060 };
  await wait(MINUTE);
  assert.equal(state(gladys, thermostat(), 'target'), 28);
  fake.report = { chModeTemp: 3.5, reportTime: 843_000_120 };
  await wait(MINUTE);
  assert.equal(state(gladys, thermostat(), 'target'), 3.5);
});

test('/data unreadable: the status says how to start again', async () => {
  const store = memoryStore({ mac: MAC }, { unreadable: true });
  const { gladys } = await boot({ store });
  assert.match(gladys.fake.connectionStatus.message.en, /uninstall then reinstall/);
  assert.match(gladys.fake.connectionStatus.message.fr, /désinstallez puis réinstallez/);
});
