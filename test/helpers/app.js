// -----------------------------------------------------------------------------
// The app against the SDK's fake Gladys, the fake thermostat and a virtual
// clock, through the exact wiring of the container (src/handlers.js).
// -----------------------------------------------------------------------------

import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { AtagApp } from '../../src/app.js';
import { buildBoilerDevice, buildThermostatDevice } from '../../src/devices.js';
import { registerHandlers } from '../../src/handlers.js';
import { memoryStore } from '../../src/store.js';
import { createFakeClock } from './fakeClock.js';
import { DEVICE_ID, createFakeThermostat } from './fakeThermostat.js';

export const SELECTOR = 'atag';
export const T0 = Date.parse('2026-10-25T08:00:00Z');
export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const BASE_CONFIG = { host: '192.168.1.20' };
export const MAC = '02-11-22-33-44-55';

const ids = createFakeGladys({ selector: SELECTOR });
export const thermostat = (deviceId = DEVICE_ID, language = 'fr') =>
  buildThermostatDevice(ids, deviceId, language);
export const boiler = (deviceId = DEVICE_ID, language = 'fr') =>
  buildBoilerDevice(ids, deviceId, language);
export const feature = (device, key) =>
  device.features.find((f) => f.external_id.endsWith(`:${key}`));
export const state = (gladys, device, key) =>
  gladys.fake.lastState(feature(device, key).external_id);
export const badge = (gladys, device) =>
  gladys.fake.transports.filter((t) => t.device_external_id === device.external_id).at(-1);

const tick = () => new Promise((resolve) => setImmediate(resolve));
export const settle = async () => {
  for (let i = 0; i < 20; i += 1) await tick();
};

/** A random source giving the same identity every time (the tests know it). */
export const fixedRandom = () => Buffer.from(MAC.split('-').map((h) => parseInt(h, 16)));

export async function setup({
  config = {},
  created = [thermostat(), boiler()],
  fake = createFakeThermostat(),
  store = memoryStore(),
  now = T0,
  connect = true,
} = {}) {
  const gladys = createFakeGladys({
    selector: SELECTOR,
    config: { ...BASE_CONFIG, ...config },
    devices: created,
  });
  const { clock, timers, advance, pending } = createFakeClock(now);
  let drift = 0;
  const logs = [];
  const logger = Object.fromEntries(
    ['debug', 'info', 'warn', 'error'].map((level) => [
      level,
      (...args) => logs.push(`${level} ${args.map((a) => a?.stack ?? String(a)).join(' ')}`),
    ]),
  );
  const app = new AtagApp({
    gladys,
    logger,
    request: fake.request,
    now: () => clock.now,
    // A real monotonic clock moves between two reads of it: 1 µs per call
    // here, so that a decision reading the clock twice is caught.
    monotonic: () => clock.now + (drift += 0.001),
    timers,
    // The spacing between two requests: the clock jumps, nothing else runs.
    sleep: async (ms) => {
      clock.now += ms;
    },
    store,
    random: fixedRandom,
  });
  registerHandlers(gladys, app, logger);
  if (connect) {
    await gladys.connect();
    await advance(0);
    await settle();
  }
  const wait = async (ms) => {
    await advance(ms);
    await settle();
  };
  return { app, gladys, fake, clock, timers, pending, advance, wait, logs, store };
}
