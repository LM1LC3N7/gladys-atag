// -----------------------------------------------------------------------------
// The Gladys devices: ids, features, options of the mode (the core's schema),
// the states of a report, never a switch.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { parseReport, replyOf } from '../src/atag/parse.js';
import {
  buildBoilerDevice,
  buildThermostatDevice,
  chControlModeOf,
  createdDevices,
  gladysModeOf,
  modeOptions,
  parseExternalId,
  statesOf,
} from '../src/devices.js';
import { DEVICE_ID, retrieveReply } from './helpers/fakeThermostat.js';

// The core's own validator of supported_options, when a Gladys clone is at hand
// (not on GitHub CI): the rules below are its schema, this is the proof.
const CORE_NORMALIZE = '/home/claude/code/Gladys/server/utils/normalizeSupportedOptions.js';
const normalizeSupportedOptions = existsSync(CORE_NORMALIZE)
  ? createRequire(import.meta.url)(CORE_NORMALIZE).normalizeSupportedOptions
  : undefined;

const gladys = createFakeGladys({ selector: 'atag' });

test('ids and names, in both languages; never a switch; every feature has its bounds', () => {
  const t = buildThermostatDevice(gladys, DEVICE_ID, 'en');
  const b = buildBoilerDevice(gladys, DEVICE_ID, 'fr');
  assert.equal(t.external_id, `ext:atag:thermostat:${DEVICE_ID}`);
  assert.equal(b.external_id, `ext:atag:boiler:${DEVICE_ID}`);
  assert.equal(t.name, `Atag One thermostat ${DEVICE_ID}`);
  assert.equal(b.name, `Chaudière Atag ${DEVICE_ID}`);
  assert.equal(t.should_poll, false);
  for (const feature of [...t.features, ...b.features]) {
    assert.notEqual(feature.category, 'switch', feature.name);
    assert.equal(typeof feature.name, 'string');
    assert.ok(feature.name.length > 0);
    assert.ok(Number.isFinite(feature.min) && Number.isFinite(feature.max), feature.name);
    assert.ok(
      feature.external_id.startsWith(`${t.external_id}:`) ||
        feature.external_id.startsWith(`${b.external_id}:`),
    );
  }
  const writable = [...t.features, ...b.features].filter((f) => !f.read_only);
  assert.deepEqual(
    writable.map((f) => f.external_id.split(':').at(-1)),
    ['target', 'mode', 'dhw_target'],
  );
  const target = t.features.find((f) => f.external_id.endsWith(':target'));
  assert.deepEqual([target.min, target.max, target.unit], [4, 27, 'celsius']);
  const dhw = b.features.find((f) => f.external_id.endsWith(':dhw_target'));
  assert.deepEqual(
    [dhw.min, dhw.max, dhw.category, dhw.type],
    [30, 65, 'water-heater', 'target-temperature'],
  );
});

test('the mode options follow the schema of the core (label a string, integer values, no duplicate)', () => {
  const t = buildThermostatDevice(gladys, DEVICE_ID, 'fr');
  const mode = t.features.find((f) => f.external_id.endsWith(':mode'));
  assert.equal(mode.category, 'thermostat');
  assert.equal(mode.type, 'mode');
  assert.equal(mode.unit, undefined, 'an enum carries no unit');
  const options = mode.supported_options;
  assert.deepEqual(
    options.map((o) => o.value),
    [1, 3],
    'THERMOSTAT_MODE.HEATING and AUTO; no OFF (the thermostat has none)',
  );
  for (const option of options) {
    assert.equal(typeof option.label, 'string', `label of ${option.value}`);
    assert.ok(option.label.trim().length > 0);
    assert.ok(Number.isInteger(option.value));
    assert.ok(Number.isInteger(option.sort_order));
  }
  assert.equal(new Set(options.map((o) => `${o.value}`)).size, options.length);
  if (normalizeSupportedOptions) {
    assert.deepEqual(normalizeSupportedOptions(options), options);
  }
  assert.equal(modeOptions('en')[0].label, 'Heating (regular control)');
  assert.equal(modeOptions('fr')[1].label, 'Automatique (selon la météo)');
  assert.deepEqual([gladysModeOf(0), gladysModeOf(1), gladysModeOf(null)], [3, 1, null]);
  assert.deepEqual([chControlModeOf(1), chControlModeOf(3), chControlModeOf(0)], [1, 0, undefined]);
});

test('parseExternalId and createdDevices', () => {
  assert.deepEqual(parseExternalId(gladys, `ext:atag:thermostat:${DEVICE_ID}`), {
    kind: 'thermostat',
    deviceId: DEVICE_ID,
    feature: null,
  });
  assert.deepEqual(parseExternalId(gladys, `ext:atag:boiler:${DEVICE_ID}:pressure`), {
    kind: 'boiler',
    deviceId: DEVICE_ID,
    feature: 'pressure',
  });
  assert.equal(parseExternalId(gladys, `ext:atag:boiler:${DEVICE_ID}:a:b`), null);
  assert.equal(parseExternalId(gladys, 'ext:atag:boiler:'), null);
  assert.equal(parseExternalId(gladys, 'ext:atag:boiler:ab'), null);
  assert.equal(parseExternalId(gladys, 'ext:atag:boiler:a b c d'), null);
  assert.equal(parseExternalId(gladys, 'ext:other:boiler:abcd'), null);
  assert.equal(parseExternalId(gladys, 42), null);
  const created = createdDevices(gladys, [
    buildThermostatDevice(gladys, DEVICE_ID, 'fr'),
    { external_id: 'ext:atag:boiler:other-1234' },
    { external_id: 'ext:atag:x:y' },
    null,
  ]);
  assert.deepEqual(
    created.map((d) => [d.kind, d.deviceId]),
    [
      ['thermostat', DEVICE_ID],
      ['boiler', 'other-1234'],
    ],
  );
});

test('statesOf: only the devices of the report, nothing for unknown values', () => {
  const report = parseReport(
    replyOf(retrieveReply({ boilerStatus: 10, roomTemp: 'x' }), 'retrieve'),
  );
  const created = createdDevices(gladys, [
    buildThermostatDevice(gladys, DEVICE_ID, 'fr'),
    buildBoilerDevice(gladys, DEVICE_ID, 'fr'),
    { external_id: 'ext:atag:boiler:other-1234' },
  ]);
  const states = statesOf(gladys, created, report, 'en');
  const byKey = Object.fromEntries(
    states.map((s) => [s.device_feature_external_id.split(':').at(-1), s.text ?? s.state]),
  );
  assert.equal(byKey.temperature, undefined, 'unknown: not published');
  assert.equal(byKey.target, 20);
  assert.equal(byKey.mode, 3);
  assert.equal(byKey.heating, 1);
  assert.equal(byKey.program, 'Schedule');
  assert.equal(byKey.weather, 'Partly sunny');
  assert.equal(byKey.burner, 1);
  assert.equal(byKey.status, 'Heating');
  assert.equal(byKey.dhw_mode, 'Eco');
  assert.ok(states.every((s) => !s.device_feature_external_id.includes('other-1234')));
  for (const s of states) {
    assert.ok('state' in s !== 'text' in s);
    if ('state' in s) assert.ok(Number.isFinite(s.state), s.device_feature_external_id);
  }
});

test('statesOf: a number outside the bounds of its feature is never published as a measure', () => {
  const report = parseReport(
    replyOf(
      retrieveReply({
        roomTemp: 1e300,
        chModeTemp: 500,
        dhwTempSetp: 65,
        chWaterPres: -5,
        burningHours: 1e15,
        outsideTemp: -327.68,
      }),
      'retrieve',
    ),
  );
  const created = createdDevices(gladys, [
    buildThermostatDevice(gladys, DEVICE_ID, 'fr'),
    buildBoilerDevice(gladys, DEVICE_ID, 'fr'),
  ]);
  const keys = statesOf(gladys, created, report, 'en').map((s) =>
    s.device_feature_external_id.split(':').at(-1),
  );
  for (const key of ['temperature', 'target', 'pressure', 'burning_hours', 'outside_temp']) {
    assert.ok(!keys.includes(key), key);
  }
  assert.ok(keys.includes('dhw_target'), 'a hot water setpoint of 65 read is shown');
});

test('statesOf: the hot water temperatures of a thermostat in Fahrenheit are not published', () => {
  const report = parseReport(replyOf(retrieveReply({ tempUnit: 1 }), 'retrieve'));
  const created = createdDevices(gladys, [buildBoilerDevice(gladys, DEVICE_ID, 'fr')]);
  const keys = statesOf(gladys, created, report, 'en').map((s) =>
    s.device_feature_external_id.split(':').at(-1),
  );
  assert.ok(!keys.includes('dhw_target'));
  assert.ok(!keys.includes('dhw_water_temp'));
  assert.ok(keys.includes('pressure'));
});
