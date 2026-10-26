// -----------------------------------------------------------------------------
// The configuration the user fills (manifest `config_schema`), normalized.
// -----------------------------------------------------------------------------

import { DEFAULT_PORT, DHW_SETPOINT } from './constants.js';

export const LANGUAGES = Object.freeze(['fr', 'en']);

// Defaults: they MUST match the `default` values of the manifest.
export const DEFAULTS = Object.freeze({
  language: 'fr',
  allow_setpoint: false,
  allow_mode: false,
  allow_dhw_setpoint: false,
  dhw_max: DHW_SETPOINT.DEFAULT_MAX,
});

const text = (value) => (typeof value === 'string' ? value.trim() : '');
const bool = (value, fallback) => {
  if (value === true || value === 'true' || value === 1 || value === '1') return true;
  if (value === false || value === 'false' || value === 0 || value === '0') return false;
  return fallback;
};

/**
 * The address of the thermostat: `192.168.1.20`, `atag-one.local`, `host:port`
 * or `http://host[:port]` (port 10000 by default). The thermostat speaks plain
 * HTTP only on this port: https is refused (said to the user rather than
 * failing in silence). Credentials, a path, a query and a fragment are
 * refused (an address ends up in logs).
 *   -> { origin, hostname, port } or { error: 'empty' | 'invalid' | 'credentials' | 'https' }
 */
export function parseHost(value) {
  const raw = text(value);
  if (!raw) return { error: 'empty' };
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(raw)?.[1]?.toLowerCase();
  if (scheme === 'https') return { error: 'https' };
  if (scheme && scheme !== 'http') return { error: 'invalid' };
  let url;
  try {
    url = new URL(scheme ? raw : `http://${raw}`);
  } catch {
    return { error: 'invalid' };
  }
  if (url.username || url.password) return { error: 'credentials' };
  if (url.search || url.hash || !url.hostname || url.pathname.replace(/\/+$/, '') !== '') {
    return { error: 'invalid' };
  }
  const port = url.port ? Number(url.port) : DEFAULT_PORT;
  const hostname = url.hostname.toLowerCase();
  return { origin: `http://${hostname}:${port}`, hostname, port };
}

/**
 * The hot water cap the user chose: a number between the floor and HARD_MAX;
 * anything else (empty, text, above the hard cap) gives the default, said in
 * `dhwMaxInvalid` so the status tells it.
 */
export function parseDhwMax(value) {
  if (value === undefined || value === null || value === '') return { value: DEFAULTS.dhw_max };
  const raw = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(raw) || raw < DHW_SETPOINT.FLOOR || raw > DHW_SETPOINT.HARD_MAX) {
    return { value: DEFAULTS.dhw_max, invalid: true };
  }
  return { value: Math.floor(raw * 2) / 2 };
}

export function normalizeConfig(raw = {}) {
  raw = raw ?? {};
  const host = parseHost(raw.host);
  const language = LANGUAGES.includes(String(raw.language))
    ? String(raw.language)
    : DEFAULTS.language;
  const dhwMax = parseDhwMax(raw.dhw_max);
  return {
    thermostat: host.error ? null : host,
    hostError: host.error ?? null,
    language,
    allowSetpoint: bool(raw.allow_setpoint, DEFAULTS.allow_setpoint),
    allowMode: bool(raw.allow_mode, DEFAULTS.allow_mode),
    allowDhwSetpoint: bool(raw.allow_dhw_setpoint, DEFAULTS.allow_dhw_setpoint),
    dhwMax: dhwMax.value,
    dhwMaxInvalid: Boolean(dhwMax.invalid),
  };
}
