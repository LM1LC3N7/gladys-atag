// -----------------------------------------------------------------------------
// Keys, limits and timings. The manifest keys and the external id shapes are
// stored in user devices and scenes: never rename them (test/manifest.test.js
// ties them to the manifest).
// -----------------------------------------------------------------------------

export const ACTIONS = Object.freeze({
  TEST: 'test_connection',
});

/** `ext:<selector>:thermostat:<device_id>`: the room side of the Atag One. */
export const THERMOSTAT_TYPE = 'thermostat';
/** `ext:<selector>:boiler:<device_id>`: the boiler and the hot water. */
export const BOILER_TYPE = 'boiler';

/** What the `device_id` of the thermostat must look like to become an external id. */
export const DEVICE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{3,47}$/;

export const THERMOSTAT_FEATURES = Object.freeze({
  TEMPERATURE: 'temperature',
  TARGET: 'target',
  MODE: 'mode',
  HEATING: 'heating',
  PROGRAM: 'program',
  OUTSIDE_TEMPERATURE: 'outside_temp',
  OUTSIDE_AVERAGE: 'outside_avg',
  WEATHER: 'weather',
});

export const BOILER_FEATURES = Object.freeze({
  WATER_TEMPERATURE: 'ch_water_temp',
  RETURN_TEMPERATURE: 'ch_return_temp',
  PRESSURE: 'pressure',
  BURNER: 'burner',
  FLAME: 'flame',
  DHW_TEMPERATURE: 'dhw_water_temp',
  DHW_TARGET: 'dhw_target',
  DHW_HEATING: 'dhw_heating',
  DHW_MODE: 'dhw_mode',
  BURNING_HOURS: 'burning_hours',
  STATUS: 'status',
});

/** The Gladys thermostat modes offered (THERMOSTAT_MODE of the core). */
export const GLADYS_MODE = Object.freeze({ HEATING: 1, AUTO: 3 });
/** `ch_control_mode` of the thermostat: 0 weather-dependent (auto), 1 regular (heat). */
export const CH_CONTROL_MODE = Object.freeze({ AUTO: 0, HEAT: 1 });

/** Bits of `boiler_status` (pyatag). */
export const BOILER_BITS = Object.freeze({ BURNER: 8, DHW: 4, CH: 2 });

/**
 * The room setpoint: 4 to 27 °C, the range of the dial of the Atag One (its
 * manual), by half degrees. A value outside is refused, never clamped.
 */
export const ROOM_SETPOINT = Object.freeze({ MIN: 4, MAX: 27, STEP: 0.5 });

/**
 * The hot water setpoint: never above HARD_MAX whatever the thermostat says,
 * the user's own cap (`dhw_max`, 65 °C by default) at most; the floor is the
 * `dhw_min_set` of the thermostat, else FLOOR. Half degrees.
 */
export const DHW_SETPOINT = Object.freeze({ FLOOR: 30, DEFAULT_MAX: 65, HARD_MAX: 65, STEP: 0.5 });

export const DEFAULT_PORT = 10000;

export const TIMEOUTS = Object.freeze({
  /** One request to the thermostat (Home Assistant waits 20 s for a whole update). */
  REQUEST: 10_000,
  /** Between two requests to the thermostat (pyatag: one call per second). */
  SPACING: 1_000,
});

/** Size cap of an answer of the thermostat (a report is a few kilobytes). */
export const MAX_BYTES = 64 * 1024;

/**
 * Gladys waits 5 s for the acknowledgement of a command: past this budget,
 * counted from the moment the command arrives, nothing is sent (an action
 * must never run after Gladys showed a failure).
 */
export const COMMAND_BUDGET_MS = 3_500;
/** Room needed to start the fresh read of a command at all. */
export const COMMAND_MIN_READ_MS = 1_500;
/** Room kept after the fresh read for the update request itself. */
export const COMMAND_MIN_SEND_MS = 600;
/** Once sent, Gladys gets its answer at the latest this long after the command arrived. */
export const COMMAND_ACK_MS = 4_300;
/** The read that confirms a command, this long after its answer. */
export const CONFIRM_AFTER_MS = 5_000;

export const INTERVALS = Object.freeze({
  /** One reading of the thermostat (Home Assistant reads every 60 s). */
  POLL_MS: 60_000,
  /** Thermostat unreachable: the first retry (never faster than the reading). */
  RETRY_MIN_MS: 60_000,
  RETRY_MAX_MS: 10 * 60_000,
  /** Pairing not confirmed on the screen: the request is sent again, more and more rarely. */
  PAIR_MIN_MS: 60_000,
  PAIR_MAX_MS: 15 * 60_000,
  /** The pairing requests spent: a plain read (never a request) this often. */
  STOPPED_PROBE_MS: 3600_000,
  /** A report older than this (last successful read) is never published. */
  FRESH_MS: 2 * 60_000,
  /** The configuration of Gladys not read: asked again 30 s, 1 min, 2 min... 10 min at most. */
  CONFIG_RETRY_MIN_MS: 30_000,
  CONFIG_RETRY_MAX_MS: 10 * 60_000,
  /** A stable value is published again after this long (dated recently in Gladys). */
  HEARTBEAT_MS: 30 * 60_000,
  /** A report whose own time stopped moving this long is stale: not published. */
  STALE_MS: 2 * 3600_000,
});

export const LIMITS = Object.freeze({
  /** POST /state admits 300 states per minute per integration: we keep under. */
  STATES_PER_MINUTE: 250,
  /** Pairing requests sent by the loop alone; then only a user action sends one. */
  PAIR_REQUESTS: 8,
  /** Updates sent per command kind within a sliding minute (a scene in a loop). */
  WRITES_PER_MINUTE: 6,
});

/**
 * The hot water bounds of the thermostat (`dhw_min_set`, `dhw_max_set`) are
 * required for a hot water command, and must look like °C values: a maximum
 * of 30 to 70, a minimum of 10 to 70 not above the maximum.
 */
export const DHW_BOUNDS = Object.freeze({ MAX_LOW: 30, MAX_HIGH: 70, MIN_LOW: 10 });

/** The only control keys an update may carry. */
export const CONTROL_KEYS = Object.freeze(['ch_mode_temp', 'ch_control_mode', 'dhw_temp_setp']);
