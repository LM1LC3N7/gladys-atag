// -----------------------------------------------------------------------------
// The decoding of the answers (ported from pyatag): the Home Assistant
// fixture, the boiler bits, the enums, Fahrenheit, odd values.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  deviceIdOf,
  isAuthorized,
  parseJson,
  parseReport,
  replyOf,
  toCelsius,
  toDeviceUnit,
} from '../src/atag/parse.js';
import { retrieveReply } from './helpers/fakeThermostat.js';

/** The RECEIVE_REPLY of the Home Assistant tests (tests/components/atag/__init__.py). */
const HA_FIXTURE = {
  retrieve_reply: {
    status: { device_id: 'xxxx-xxxx-xxxx_xx-xx-xxx-xxx' },
    report: {
      burning_hours: 1000,
      room_temp: 20,
      outside_temp: 15,
      dhw_water_temp: 30,
      ch_water_temp: 40,
      ch_water_pres: 1.8,
      ch_return_temp: 35,
      boiler_status: 0,
      tout_avg: 12,
      details: { rel_mod_level: 0 },
    },
    control: {
      ch_control_mode: 0,
      ch_mode: 1,
      ch_mode_duration: 0,
      ch_mode_temp: 12,
      dhw_temp_setp: 40,
      dhw_mode: 1,
      dhw_mode_temp: 150,
      weather_status: 8,
    },
    configuration: {
      download_url: 'http://firmware.atag-one.com:80/R58',
      temp_unit: 0,
      dhw_max_set: 65,
      dhw_min_set: 40,
    },
    acc_status: 2,
  },
};

test('the Home Assistant fixture decodes', () => {
  const reply = replyOf(HA_FIXTURE, 'retrieve');
  assert.ok(isAuthorized(reply));
  assert.equal(deviceIdOf(reply), 'xxxx-xxxx-xxxx_xx-xx-xxx-xxx');
  const report = parseReport(reply);
  assert.deepEqual(report, {
    deviceId: 'xxxx-xxxx-xxxx_xx-xx-xxx-xxx',
    fahrenheit: false,
    reportTime: null,
    roomTemperature: 20,
    outsideTemperature: 15,
    outsideAverage: 12,
    chWaterTemperature: 40,
    chReturnTemperature: 35,
    dhwWaterTemperature: 30,
    pressure: 1.8,
    burningHours: 1000,
    burner: 0,
    dhwHeating: 0,
    chHeating: 0,
    flame: 0,
    chControlMode: 0,
    chMode: 'manual',
    chModeDuration: 0,
    targetTemperature: 12,
    dhwTarget: 40,
    dhwMode: 'eco',
    weather: 'partly_sunny',
    dhwMin: 40,
    dhwMax: 65,
    firmware: 'R58',
  });
});

test('the boiler bits, the enums, the flame capped', () => {
  const r = (options) => parseReport(replyOf(retrieveReply(options), 'retrieve'));
  assert.deepEqual(
    [
      r({ boilerStatus: 8 }).burner,
      r({ boilerStatus: 8 }).chHeating,
      r({ boilerStatus: 8 }).dhwHeating,
    ],
    [1, 0, 0],
  );
  assert.deepEqual(
    [
      r({ boilerStatus: 14 }).burner,
      r({ boilerStatus: 14 }).chHeating,
      r({ boilerStatus: 14 }).dhwHeating,
    ],
    [1, 1, 1],
  );
  assert.equal(r({ boilerStatus: 'x' }).burner, null);
  assert.equal(r({ chMode: 5 }).chMode, 'fireplace');
  assert.equal(r({ chMode: 9 }).chMode, null);
  assert.equal(r({ dhwMode: 0 }).dhwMode, 'performance');
  assert.equal(r({ dhwMode: 7 }).dhwMode, null);
  assert.equal(r({ weatherStatus: 13 }).weather, 'unknown');
  assert.equal(r({ weatherStatus: 99 }).weather, null);
  assert.equal(r({ chControlMode: 2 }).chControlMode, null);
  assert.equal(r({ relModLevel: 250 }).flame, 100);
  assert.equal(r({ relModLevel: -5 }).flame, 0);
  assert.equal(r({ reportTime: 843_000_000 }).reportTime, 843_000_000);
  assert.equal(r({ reportTime: 1.5 }).reportTime, null);
});

test('numbers must be numbers: a string, NaN or a missing field is unknown', () => {
  const r = (options) => parseReport(replyOf(retrieveReply(options), 'retrieve'));
  assert.equal(r({ roomTemp: '20' }).roomTemperature, null);
  assert.equal(r({ roomTemp: NaN }).roomTemperature, null);
  const missing = retrieveReply();
  delete missing.retrieve_reply.report.room_temp;
  assert.equal(parseReport(replyOf(missing, 'retrieve')).roomTemperature, null);
  assert.equal(r({ chWaterPres: Infinity }).pressure, null);
  assert.equal(r({ deviceId: 42 }).deviceId, null);
  assert.equal(r({ roomTemp: 20.556 }).roomTemperature, 20.56, 'two decimals');
  assert.equal(r({ roomTemp: 20.554 }).roomTemperature, 20.55);
});

test('Fahrenheit: converted to Celsius, and back for a command', () => {
  const r = parseReport(
    replyOf(
      retrieveReply({ tempUnit: 1, roomTemp: 68, chModeTemp: 69.8, dhwMaxSet: 149 }),
      'retrieve',
    ),
  );
  assert.equal(r.fahrenheit, true);
  assert.equal(r.roomTemperature, 20);
  assert.equal(r.targetTemperature, 21);
  assert.equal(r.dhwMax, 65);
  assert.equal(toCelsius(32), 0);
  assert.equal(toDeviceUnit(21, true), 69.8);
  assert.equal(toDeviceUnit(21, false), 21);
});

test('parseJson and replyOf are strict and bounded', () => {
  assert.equal(parseJson('[1]'), null);
  assert.equal(parseJson('null'), null);
  assert.equal(parseJson('{bad'), null);
  assert.equal(parseJson('x'.repeat(70_000)), null);
  assert.equal(replyOf({ retrieve_reply: [] }, 'retrieve'), null);
  assert.equal(replyOf({ retrieve_reply: 'x' }, 'retrieve'), null);
  assert.equal(replyOf(Object.create({ retrieve_reply: {} }), 'retrieve'), null, 'own keys only');
  assert.equal(parseReport({ acc_status: 2 }), null);
  assert.equal(parseReport({ report: {}, control: {} }).deviceId, null);
  assert.equal(
    parseReport(JSON.parse('{"report":{"__proto__":{"x":1}},"control":{}}')).roomTemperature,
    null,
  );
  assert.equal(isAuthorized({ acc_status: '2' }), false);
  assert.equal(isAuthorized(null), false);
});
