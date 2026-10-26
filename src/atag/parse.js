// -----------------------------------------------------------------------------
// The answers of the Atag One -> plain objects (ported from pyatag, MIT).
//
// Every answer is one JSON object with one key, `<path>_reply`, carrying
// `acc_status` (2: this client is authorized, anything else: the pairing is
// not confirmed on the screen of the thermostat) and `status.device_id`.
// The `retrieve_reply` adds `report` (measurements, `details` inside),
// `control` (what can be set) and `configuration`.
//
// Values are checked one by one: a number is a finite number (never a string
// turned into one), a missing or odd field is `null`, never a guess. The
// temperatures of a thermostat set to Fahrenheit are converted to Celsius.
// -----------------------------------------------------------------------------

import { BOILER_BITS } from '../constants.js';

const MAX_BYTES = 64 * 1024;
const own = (object, key) =>
  object !== null && typeof object === 'object' && !Array.isArray(object)
    ? Object.hasOwn(object, key)
      ? object[key]
      : undefined
    : undefined;
const finite = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const integer = (value) => (Number.isInteger(value) ? value : null);
const round = (value, digits) => (value === null ? null : Number(value.toFixed(digits)));

/** A JSON text of bounded size -> value, or null (never throws). */
export function parseJson(text) {
  if (typeof text !== 'string' || text.length > MAX_BYTES) return null;
  try {
    const value = JSON.parse(text);
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

/** The one `<path>_reply` of an answer: { key, reply } or null. */
export function replyOf(json, path) {
  const reply = own(json, `${path}_reply`);
  return reply !== null && typeof reply === 'object' && !Array.isArray(reply) ? reply : null;
}

/** `acc_status` 2 means authorized (pyatag). */
export const isAuthorized = (reply) => own(reply, 'acc_status') === 2;

export const deviceIdOf = (reply) => {
  const id = own(own(reply, 'status'), 'device_id');
  return typeof id === 'string' ? id.trim() : null;
};

/** Fahrenheit -> Celsius, one decimal. */
export const toCelsius = (value) => (value === null ? null : round(((value - 32) * 5) / 9, 1));
/** Celsius -> the unit of the thermostat, one decimal. */
export const toDeviceUnit = (celsius, fahrenheit) =>
  fahrenheit ? round((celsius * 9) / 5 + 32, 1) : celsius;

export const CH_MODES = Object.freeze({
  1: 'manual',
  2: 'automatic',
  3: 'vacation',
  4: 'extend',
  5: 'fireplace',
});
export const DHW_MODES = Object.freeze({ 0: 'performance', 1: 'eco' });
export const WEATHER = Object.freeze({
  0: 'sunny',
  1: 'clear',
  2: 'rainy',
  3: 'snowy',
  4: 'haily',
  5: 'windy',
  6: 'misty',
  7: 'cloudy',
  8: 'partly_sunny',
  9: 'partly_cloudy',
  10: 'shower',
  11: 'lightning',
  12: 'hurricane',
  13: 'unknown',
});

/**
 * The report of a `retrieve_reply` -> a plain object, or null when it is not
 * one. Temperatures in °C, pressure in bar, flame in %, hours as given.
 *
 * The hot water fields (`dhw_*`) are kept as the thermostat gives them,
 * never converted: Home Assistant treats them as °C whatever `temp_unit`
 * says, pyatag follows `temp_unit`; nobody checked on a real thermostat. On a
 * thermostat in Fahrenheit (`fahrenheit: true`) they are neither published
 * nor commanded (TODO.md).
 */
export function parseReport(reply) {
  const report = own(reply, 'report');
  const control = own(reply, 'control');
  const configuration = own(reply, 'configuration');
  if (!report || typeof report !== 'object' || !control || typeof control !== 'object') {
    return null;
  }
  const details = own(report, 'details') ?? {};
  const fahrenheit = own(configuration, 'temp_unit') === 1;
  const temperature = (value) => {
    const raw = finite(value);
    return fahrenheit ? toCelsius(raw) : round(raw, 2);
  };
  const asGiven = (value) => round(finite(value), 2);
  const boilerStatus = integer(own(report, 'boiler_status'));
  const bit = (mask) => (boilerStatus === null ? null : (boilerStatus & mask) === mask ? 1 : 0);
  const chMode = integer(own(control, 'ch_mode'));
  const dhwMode = integer(own(control, 'dhw_mode'));
  const weather = integer(own(control, 'weather_status'));
  const chControlMode = integer(own(control, 'ch_control_mode'));
  const flame = finite(own(details, 'rel_mod_level'));
  return {
    deviceId: deviceIdOf(reply),
    fahrenheit,
    /** Seconds since 2000-01-01 on the clock of the thermostat (its own stamp). */
    reportTime: integer(own(report, 'report_time')),
    roomTemperature: temperature(own(report, 'room_temp')),
    outsideTemperature: temperature(own(report, 'outside_temp')),
    outsideAverage: temperature(own(report, 'tout_avg')),
    chWaterTemperature: temperature(own(report, 'ch_water_temp')),
    chReturnTemperature: temperature(own(report, 'ch_return_temp')),
    dhwWaterTemperature: asGiven(own(report, 'dhw_water_temp')),
    pressure: round(finite(own(report, 'ch_water_pres')), 2),
    burningHours: finite(own(report, 'burning_hours')),
    burner: bit(BOILER_BITS.BURNER),
    dhwHeating: bit(BOILER_BITS.DHW),
    chHeating: bit(BOILER_BITS.CH),
    flame: flame === null ? null : Math.min(100, Math.max(0, round(flame, 1))),
    chControlMode: chControlMode === 0 || chControlMode === 1 ? chControlMode : null,
    chMode: CH_MODES[chMode] ?? null,
    chModeDuration: integer(own(control, 'ch_mode_duration')),
    targetTemperature: temperature(own(control, 'ch_mode_temp')),
    dhwTarget: asGiven(own(control, 'dhw_temp_setp')),
    dhwMode: DHW_MODES[dhwMode] ?? null,
    weather: WEATHER[weather] ?? null,
    dhwMin: asGiven(own(configuration, 'dhw_min_set')),
    dhwMax: asGiven(own(configuration, 'dhw_max_set')),
    firmware: (() => {
      const url = own(configuration, 'download_url');
      if (typeof url !== 'string') return null;
      const last = url.split('/').at(-1) ?? '';
      return /^[A-Za-z0-9._-]{1,32}$/.test(last) ? last : null;
    })(),
  };
}
