// -----------------------------------------------------------------------------
// The configuration: the address, the options, the hot water cap.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, normalizeConfig, parseDhwMax, parseHost } from '../src/config.js';

test('parseHost: IP, name, port, http scheme; the rest refused', () => {
  assert.deepEqual(parseHost('192.168.1.20'), {
    origin: 'http://192.168.1.20:10000',
    hostname: '192.168.1.20',
    port: 10000,
  });
  assert.equal(parseHost(' Atag-One.local:8080 ').origin, 'http://atag-one.local:8080');
  assert.equal(parseHost('http://192.168.1.20/').origin, 'http://192.168.1.20:10000');
  assert.equal(parseHost('[fe80::1]:10000').origin, 'http://[fe80::1]:10000');
  assert.deepEqual(parseHost(''), { error: 'empty' });
  assert.deepEqual(parseHost(undefined), { error: 'empty' });
  assert.deepEqual(parseHost('https://192.168.1.20'), { error: 'https' });
  assert.deepEqual(parseHost('ftp://192.168.1.20'), { error: 'invalid' });
  assert.deepEqual(parseHost('http://u:p@192.168.1.20'), { error: 'credentials' });
  assert.deepEqual(parseHost('192.168.1.20/retrieve'), { error: 'invalid' });
  assert.deepEqual(parseHost('192.168.1.20?x=1'), { error: 'invalid' });
  assert.deepEqual(parseHost('192.168.1.20#x'), { error: 'invalid' });
  assert.deepEqual(parseHost('a b'), { error: 'invalid' });
});

test('parseDhwMax: 30 to 60, half degrees, the default otherwise', () => {
  assert.deepEqual(parseDhwMax(undefined), { value: 55 });
  assert.deepEqual(parseDhwMax(''), { value: 55 });
  assert.deepEqual(parseDhwMax(50), { value: 50 });
  assert.deepEqual(parseDhwMax('48.7'), { value: 48.5 });
  assert.deepEqual(parseDhwMax(60), { value: 60 });
  assert.deepEqual(parseDhwMax(61), { value: 55, invalid: true });
  assert.deepEqual(parseDhwMax(29), { value: 55, invalid: true });
  assert.deepEqual(parseDhwMax('abc'), { value: 55, invalid: true });
  assert.deepEqual(parseDhwMax(true), { value: 55, invalid: true });
});

test('normalizeConfig: defaults, booleans in every form, language', () => {
  const config = normalizeConfig({ host: '192.168.1.20' });
  assert.equal(config.thermostat.origin, 'http://192.168.1.20:10000');
  assert.equal(config.hostError, null);
  assert.equal(config.language, DEFAULTS.language);
  assert.equal(config.allowSetpoint, false);
  assert.equal(config.allowMode, false);
  assert.equal(config.allowDhwSetpoint, false);
  assert.equal(config.dhwMax, 55);
  assert.equal(config.dhwMaxInvalid, false);
  const on = normalizeConfig({
    host: 'x',
    allow_setpoint: 'true',
    allow_mode: 1,
    allow_dhw_setpoint: '1',
    language: 'en',
    dhw_max: 58,
  });
  assert.deepEqual([on.allowSetpoint, on.allowMode, on.allowDhwSetpoint], [true, true, true]);
  assert.equal(on.language, 'en');
  assert.equal(on.dhwMax, 58);
  assert.equal(normalizeConfig({ language: 'de' }).language, 'fr');
  assert.equal(normalizeConfig(null).hostError, 'empty');
  assert.equal(normalizeConfig({ host: 'x', allow_setpoint: 'maybe' }).allowSetpoint, false);
});
