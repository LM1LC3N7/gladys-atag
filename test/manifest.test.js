// -----------------------------------------------------------------------------
// The manifest is the contract with Gladys and the store: these tests tie it
// to the code, so a key renamed on one side only fails here.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEVICE_FEATURE_UNITS } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { DEFAULTS, LANGUAGES } from '../src/config.js';
import { ACTIONS } from '../src/constants.js';
import { buildBoilerDevice, buildThermostatDevice } from '../src/devices.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('gladys-assistant-integration.json'));
const pkg = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));
const handlers = read('src/handlers.js');
const dockerfile = read('Dockerfile');

function* texts(node, path = '') {
  if (Array.isArray(node)) {
    for (const [i, item] of node.entries()) yield* texts(item, `${path}[${i}]`);
  } else if (node && typeof node === 'object') {
    if ('en' in node || 'fr' in node) {
      yield [path, node];
      return;
    }
    for (const [key, value] of Object.entries(node)) yield* texts(value, `${path}.${key}`);
  }
}

const keys = (list) => (list ?? []).map((item) => item.key);
const fields = Object.fromEntries(manifest.config_schema.map((f) => [f.key, f]));

test('the store basics; the version set by hand everywhere, never frozen here', () => {
  assert.equal(manifest.manifest_version, 1);
  assert.equal(manifest.type, 'device');
  assert.equal(manifest.gladys_version, '>=5.1.0');
  assert.equal(manifest.keywords, undefined, 'keywords need gladys_version >= 5.3.0 (TODO.md)');
  assert.equal(manifest.countries, undefined);
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  assert.equal(manifest.version, pkg.version);
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].version, pkg.version);
  assert.equal(manifest.docker_image, `ghcr.io/lm1lc3n7/gladys-atag:${manifest.version}`);
  assert.equal(pkg.name, 'gladys-atag');
  assert.equal(lock.name, 'gladys-atag');
  assert.deepEqual(Object.keys(pkg.dependencies), ['@gladysassistant/integration-sdk']);
  assert.deepEqual(manifest.transports, ['local']);
  assert.deepEqual(manifest.categories, ['climate']);
  assert.ok(manifest.name.length >= 3 && manifest.name.length <= 30);
  for (const lang of ['en', 'fr']) {
    const length = manifest.description[lang].length;
    assert.ok(length >= 10 && length <= 100, `description.${lang}: ${length} characters`);
    assert.ok(read(`docs/${lang}.md`).length >= 300, `docs/${lang}.md is too short for the store`);
  }
  assert.match(fields.intro.description.en, /Unofficial integration, not affiliated/);
  assert.match(fields.intro.description.fr, /non officielle, sans lien/);
  assert.match(read('docs/en.md'), /never been tested on a real thermostat/i);
  assert.match(read('docs/fr.md'), /jamais été testée sur un vrai thermostat/i);
});

test('the license and the notices ship in the image; no person named in LICENSE', () => {
  const license = read('LICENSE');
  assert.match(license, /Apache License\s+Version 2\.0/);
  assert.match(license, /Copyright \[yyyy\] \[name of copyright owner\]/, 'the standard text');
  assert.match(read('THIRD_PARTY_NOTICES.md'), /pyatag[\s\S]*MIT License[\s\S]*YOUR NAME/);
  assert.match(read('THIRD_PARTY_NOTICES.md'), /Home Assistant[\s\S]*Apache License/);
  assert.match(dockerfile, /COPY[^\n]*LICENSE[^\n]*THIRD_PARTY_NOTICES\.md/);
});

test('every text is bilingual', () => {
  for (const [path, text] of texts(manifest)) {
    assert.ok(text.en?.trim() && text.fr?.trim(), `${path} needs en and fr`);
  }
});

test('the configuration matches the code; every command off by default; no secret field', () => {
  for (const [key, value] of Object.entries(DEFAULTS)) {
    assert.equal(fields[key].default, value, key);
  }
  assert.deepEqual(
    fields.language.options.map((o) => o.value),
    LANGUAGES,
  );
  assert.deepEqual(keys(manifest.config_schema), [
    'intro',
    'host',
    'options_section',
    'allow_setpoint',
    'allow_mode',
    'allow_dhw_setpoint',
    'dhw_max',
    'language',
  ]);
  for (const key of ['allow_setpoint', 'allow_mode', 'allow_dhw_setpoint']) {
    assert.equal(fields[key].type, 'boolean', key);
    assert.equal(fields[key].default, false, key);
  }
  assert.equal(fields.dhw_max.type, 'number');
  assert.equal(fields.dhw_max.default, 65);
  assert.match(fields.dhw_max.description.en, /never above 65 °C/);
  assert.ok(!manifest.config_schema.some((f) => f.type === 'secret'), 'nothing secret to keep');
  assert.ok(
    !manifest.config_schema.some((f) => f.key.startsWith('gladys_')),
    'GLADYS_* is the core',
  );
  assert.doesNotMatch(JSON.stringify(manifest), /chiffré|encrypted/i);
  assert.match(fields.options_section.description.en, /No feature is a switch/);
  assert.match(fields.options_section.description.en, /no "off"/);
});

test('sections store nothing', () => {
  for (const section of manifest.config_schema.filter((f) => f.type === 'section')) {
    assert.equal(section.required, undefined, section.key);
    assert.equal(section.default, undefined, section.key);
    assert.ok(!(section.key in DEFAULTS), section.key);
    for (const link of section.links ?? []) assert.match(link.url, /^https:\/\//);
  }
});

test('the keys of the manifest are the keys of the code, all registered', () => {
  assert.deepEqual(keys(manifest.actions).sort(), Object.values(ACTIONS).sort());
  for (const name of Object.keys(ACTIONS)) {
    assert.ok(handlers.includes(`onAction(ACTIONS.${name}`), name);
  }
  assert.ok(manifest.actions.every((a) => a.timeout_seconds >= 5 && a.timeout_seconds <= 120));
  assert.equal(manifest.scene_actions, undefined);
  assert.equal(manifest.scene_triggers, undefined);
  assert.equal(manifest.widgets, undefined);
  for (const handler of ['onScanRequest(', 'onSetValue(', 'onConfigUpdated(']) {
    assert.ok(handlers.includes(handler), handler);
  }
});

test('units: only those the core lists for the category (server/utils/constants.js)', () => {
  // DEVICE_FEATURE_UNITS_BY_CATEGORY (and _AND_TYPE) of the core, for the categories used here.
  const allowed = {
    'temperature-sensor': ['celsius', 'fahrenheit', 'kelvin'],
    'pressure-sensor': ['pascal', 'hPa', 'kPa', 'bar', 'psi', 'milli-bar'],
    thermostat: ['celsius', 'fahrenheit'],
    'water-heater': ['celsius', 'fahrenheit'],
    duration: ['microseconds', 'milliseconds', 'seconds', 'minutes', 'hours', 'days'],
  };
  const gladys = createFakeGladys({ selector: 'atag' });
  const features = [
    ...buildThermostatDevice(gladys, 'abcd-1234', 'fr').features,
    ...buildBoilerDevice(gladys, 'abcd-1234', 'fr').features,
  ];
  for (const feature of features) {
    if (feature.unit === undefined) {
      assert.ok(
        ['unknown', 'text'].includes(feature.category) ||
          ['mode', 'operating-state', 'heating'].includes(feature.type),
        `${feature.name}: no unit`,
      );
      continue;
    }
    assert.ok(Object.values(DEVICE_FEATURE_UNITS).includes(feature.unit));
    assert.ok(
      allowed[feature.category]?.includes(feature.unit),
      `${feature.name}: ${feature.unit}`,
    );
  }
  const pressure = features.find((f) => f.external_id.endsWith(':pressure'));
  assert.equal(pressure.unit, 'bar');
  const hours = features.find((f) => f.external_id.endsWith(':burning_hours'));
  assert.equal(hours.unit, 'hours');
});
