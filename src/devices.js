// -----------------------------------------------------------------------------
// Gladys devices (pure).
//
//   thermostat  `ext:<selector>:thermostat:<device_id>`
//               the room side: room temperature, setpoint (command, off by
//               default), control mode (command, off by default), heating,
//               program, outside temperatures, weather
//   boiler      `ext:<selector>:boiler:<device_id>`
//               the boiler and the hot water: flow and return temperatures,
//               pressure, burner, modulation, hot water temperature, hot water
//               setpoint (command, off by default, capped), hot water
//               production and mode, burner hours, status in words
//
// The device_id is the one the thermostat answers (`status.device_id`),
// stable for a thermostat; the address only serves the requests.
//
// Never a `switch`: the core hands every switch to the voice assistants, MCP
// and the "turn everything off" scene actions. The binary readings are
// `unknown`/`binary` or `water-heater`/`heating`, read only; the mode offers
// no "off" (the thermostat has none).
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import {
  BOILER_FEATURES as BF,
  BOILER_TYPE,
  DEVICE_ID_PATTERN,
  DHW_SETPOINT,
  GLADYS_MODE,
  ROOM_SETPOINT,
  THERMOSTAT_FEATURES as TF,
  THERMOSTAT_TYPE,
} from './constants.js';
import { statusText, texts } from './i18n.js';

export const thermostatIds = (gladys, deviceId) => gladys.externalIds(THERMOSTAT_TYPE, deviceId);
export const boilerIds = (gladys, deviceId) => gladys.externalIds(BOILER_TYPE, deviceId);

const readOnly = (extra) => ({
  read_only: true,
  has_feedback: false,
  keep_history: true,
  ...extra,
});
const binary = () => readOnly({ category: C.UNKNOWN, type: T.SENSOR.BINARY, min: 0, max: 1 });
/**
 * A water or outside temperature is a `probe` (not the air of the room the
 * thermostat is in): the core keeps it out of the temperature of the room.
 */
const temperature = (min, max, type = T.TEMPERATURE_SENSOR.PROBE) =>
  readOnly({ category: C.TEMPERATURE_SENSOR, type, unit: U.CELSIUS, min, max });
const words = () =>
  readOnly({ category: C.TEXT, type: T.TEXT.TEXT, min: 0, max: 0, keep_history: false });

/** The modes offered: Heating (regular) and Auto (weather-dependent), THERMOSTAT_MODE of the core. */
export function modeOptions(language) {
  const t = texts(language).modes;
  return [
    { value: GLADYS_MODE.HEATING, label: t.heat, sort_order: 0 },
    { value: GLADYS_MODE.AUTO, label: t.auto, sort_order: 1 },
  ];
}

export function buildThermostatDevice(gladys, deviceId, language) {
  const ids = thermostatIds(gladys, deviceId);
  const t = texts(language);
  const named = (key, feature) => ({
    name: t.features[key],
    external_id: ids.feature(key),
    ...feature,
  });
  return {
    name: t.thermostat(deviceId),
    external_id: ids.device,
    model: 'Atag One',
    should_poll: false,
    features: [
      named(TF.TEMPERATURE, temperature(-20, 60, T.SENSOR.DECIMAL)),
      // Commands, refused unless the user allowed them (`allow_setpoint`,
      // `allow_mode`, off by default): read_only is fixed when the device is
      // created, so the permission is checked at each command instead.
      named(TF.TARGET, {
        category: C.THERMOSTAT,
        type: T.THERMOSTAT.TARGET_TEMPERATURE,
        unit: U.CELSIUS,
        min: ROOM_SETPOINT.MIN,
        max: ROOM_SETPOINT.MAX,
        read_only: false,
        has_feedback: true,
        keep_history: true,
      }),
      named(TF.MODE, {
        category: C.THERMOSTAT,
        type: T.THERMOSTAT.MODE,
        min: GLADYS_MODE.HEATING,
        max: GLADYS_MODE.AUTO,
        read_only: false,
        has_feedback: true,
        keep_history: true,
        supported_options: modeOptions(language),
      }),
      named(
        TF.HEATING,
        readOnly({ category: C.THERMOSTAT, type: T.THERMOSTAT.OPERATING_STATE, min: 0, max: 1 }),
      ),
      named(TF.PROGRAM, words()),
      named(TF.OUTSIDE_TEMPERATURE, temperature(-50, 60)),
      named(TF.OUTSIDE_AVERAGE, temperature(-50, 60)),
      named(TF.WEATHER, words()),
    ],
  };
}

export function buildBoilerDevice(gladys, deviceId, language) {
  const ids = boilerIds(gladys, deviceId);
  const t = texts(language);
  const named = (key, feature) => ({
    name: t.features[key],
    external_id: ids.feature(key),
    ...feature,
  });
  return {
    name: t.boiler(deviceId),
    external_id: ids.device,
    model: 'Atag boiler (Atag One)',
    should_poll: false,
    features: [
      named(BF.WATER_TEMPERATURE, temperature(0, 120)),
      named(BF.RETURN_TEMPERATURE, temperature(0, 120)),
      named(
        BF.PRESSURE,
        readOnly({
          category: C.PRESSURE_SENSOR,
          type: T.SENSOR.DECIMAL,
          unit: U.BAR,
          min: 0,
          max: 10,
        }),
      ),
      named(BF.BURNER, binary()),
      named(BF.FLAME, readOnly({ category: C.UNKNOWN, type: T.SENSOR.DECIMAL, min: 0, max: 100 })),
      named(BF.DHW_TEMPERATURE, temperature(0, 120)),
      // A command, refused unless `allow_dhw_setpoint`; the cap of the user
      // (55 °C by default, 60 °C at most) applies at each command, the
      // thermostat's own bounds too (read at each command).
      named(BF.DHW_TARGET, {
        category: C.WATER_HEATER,
        type: T.WATER_HEATER.TARGET_TEMPERATURE,
        unit: U.CELSIUS,
        min: DHW_SETPOINT.FLOOR,
        max: DHW_SETPOINT.HARD_MAX,
        read_only: false,
        has_feedback: true,
        keep_history: true,
      }),
      named(
        BF.DHW_HEATING,
        readOnly({ category: C.WATER_HEATER, type: T.WATER_HEATER.HEATING, min: 0, max: 1 }),
      ),
      named(BF.DHW_MODE, words()),
      named(
        BF.BURNING_HOURS,
        readOnly({
          category: C.DURATION,
          type: T.DURATION.INTEGER,
          unit: U.HOURS,
          min: 0,
          max: 1_000_000,
        }),
      ),
      named(BF.STATUS, words()),
    ],
  };
}

/**
 * What a device or feature external id of this integration designates:
 * { kind: 'thermostat' | 'boiler', deviceId, feature } | null.
 */
export function parseExternalId(gladys, externalId) {
  if (typeof externalId !== 'string') return null;
  for (const kind of [THERMOSTAT_TYPE, BOILER_TYPE]) {
    const prefix = gladys.externalId(`${kind}:`);
    if (!externalId.startsWith(prefix)) continue;
    const [deviceId, feature, ...rest] = externalId.slice(prefix.length).split(':');
    if (rest.length > 0 || !DEVICE_ID_PATTERN.test(deviceId ?? '')) return null;
    return { kind, deviceId, feature: feature ?? null };
  }
  return null;
}

/** The created devices of this integration: [{ kind, deviceId, externalId }]. */
export function createdDevices(gladys, devices = gladys.devices) {
  const list = [];
  for (const device of devices ?? []) {
    const parsed = parseExternalId(gladys, device?.external_id);
    if (!parsed || parsed.feature !== null) continue;
    list.push({ ...parsed, externalId: device.external_id });
  }
  return list;
}

const bit = (value) => (value === null ? null : value ? 1 : 0);

/**
 * What a reading may be to be published: the `min`/`max` of its feature,
 * except the hot water setpoint, whose feature stops at the command cap
 * (60 °C) while a thermostat may report up to its own maximum.
 */
const READING_BOUNDS = Object.freeze({ [BF.DHW_TARGET]: [0, 100] });

/**
 * The states of the created devices for a report of `deviceId`
 * (`[{ device_feature_external_id, state | text }]`). Unknown values give
 * nothing, and so does a number outside the bounds of its feature (a
 * sentinel, a hostile answer: never published as a measure). The hot water
 * temperatures of a thermostat in Fahrenheit are not published (their unit
 * is not verified, see parse.js). The Gladys mode is 1 (heating) for
 * `ch_control_mode` 1, 3 (auto) for 0.
 */
export function statesOf(gladys, created, report, language) {
  const t = texts(language);
  const states = [];
  const bounds = new Map();
  for (const device of [
    buildThermostatDevice(gladys, report.deviceId, language),
    buildBoilerDevice(gladys, report.deviceId, language),
  ]) {
    for (const f of device.features) {
      const key = f.external_id.split(':').at(-1);
      bounds.set(f.external_id, READING_BOUNDS[key] ?? [f.min, f.max]);
    }
  }
  const add = (id, value) => {
    if (value === null || value === undefined) return;
    if (typeof value === 'number') {
      const [min, max] = bounds.get(id) ?? [-Infinity, Infinity];
      if (!(value >= min && value <= max)) return;
    }
    states.push(
      typeof value === 'string'
        ? { device_feature_external_id: id, text: value }
        : { device_feature_external_id: id, state: value },
    );
  };
  for (const { kind, deviceId } of created) {
    if (deviceId !== report.deviceId) continue;
    if (kind === THERMOSTAT_TYPE) {
      const ids = thermostatIds(gladys, deviceId);
      add(ids.feature(TF.TEMPERATURE), report.roomTemperature);
      add(ids.feature(TF.TARGET), report.targetTemperature);
      add(ids.feature(TF.MODE), gladysModeOf(report.chControlMode));
      add(ids.feature(TF.HEATING), bit(report.chHeating));
      add(ids.feature(TF.PROGRAM), report.chMode ? t.programs[report.chMode] : null);
      add(ids.feature(TF.OUTSIDE_TEMPERATURE), report.outsideTemperature);
      add(ids.feature(TF.OUTSIDE_AVERAGE), report.outsideAverage);
      add(ids.feature(TF.WEATHER), report.weather ? t.weather[report.weather] : null);
    } else {
      const ids = boilerIds(gladys, deviceId);
      add(ids.feature(BF.WATER_TEMPERATURE), report.chWaterTemperature);
      add(ids.feature(BF.RETURN_TEMPERATURE), report.chReturnTemperature);
      add(ids.feature(BF.PRESSURE), report.pressure);
      add(ids.feature(BF.BURNER), bit(report.burner));
      add(ids.feature(BF.FLAME), report.flame);
      if (!report.fahrenheit) {
        add(ids.feature(BF.DHW_TEMPERATURE), report.dhwWaterTemperature);
        add(ids.feature(BF.DHW_TARGET), report.dhwTarget);
      }
      add(ids.feature(BF.DHW_HEATING), bit(report.dhwHeating));
      add(ids.feature(BF.DHW_MODE), report.dhwMode ? t.dhwModes[report.dhwMode] : null);
      add(
        ids.feature(BF.BURNING_HOURS),
        report.burningHours === null ? null : Math.round(report.burningHours),
      );
      add(ids.feature(BF.STATUS), statusText(report, language));
    }
  }
  return states;
}

/** `ch_control_mode` -> THERMOSTAT_MODE of the core (null when unknown). */
export const gladysModeOf = (chControlMode) =>
  chControlMode === 1 ? GLADYS_MODE.HEATING : chControlMode === 0 ? GLADYS_MODE.AUTO : null;

/** THERMOSTAT_MODE of the core -> `ch_control_mode` (undefined when not offered). */
export const chControlModeOf = (gladysMode) =>
  gladysMode === GLADYS_MODE.HEATING ? 1 : gladysMode === GLADYS_MODE.AUTO ? 0 : undefined;
