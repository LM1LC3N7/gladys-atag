# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration**: a Node.js service (Node 22+, ESM,
no build step) that runs in its own sandboxed Docker container and talks to
Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
its only runtime dependency. It reads and commands an Atag One thermostat
through its local HTTP interface (port 10000, plain HTTP, JSON messages
ported from pyatag).

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/app.test.js              # one file
node --test --test-name-pattern "setpoint" # tests whose name matches
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npx github:GladysAssistant/integration-store .   # store admission checks
```

The CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on
Node 22 and 24, and builds the Docker image: run the three commands before
pushing (`gi ci` on the development VM does all of it).

## Architecture

```
index.js                          SDK wiring only (src/handlers.js registers the handlers)
src/handlers.js                   every SDK handler, wired to the app (shared with the tests)
src/app.js                        AtagApp: lifecycle, pace, pairing, reading, commands
src/atag/client.js                /pair, /retrieve, /update; one request a second; retries
src/atag/http.js                  the only network access (node:http, POST JSON)
src/atag/parse.js                 answers -> plain objects (ported from pyatag)
src/atag/errors.js                ThermostatError, codes
src/publisher.js                  the states-per-minute window (300/min limit of Gladys)
src/store.js                      /data: client identity, last read, pairing backoff
src/devices.js                    the Gladys devices and their external ids (pure)
src/config.js                     DEFAULTS (mirror the manifest defaults) + normalization
src/constants.js, src/i18n.js     keys, limits, timings; runtime and device texts (en/fr)
gladys-assistant-integration.json manifest: name, config_schema, actions...
docs/en.md, docs/fr.md            user documentation, re-hosted by Gladys (mandatory)
test/                             node --test: SDK fake Gladys, fake thermostat, loopback, real clock
scripts/cover.mjs                 generates cover.png (plain Node)
.github/scripts/release.mjs       release helpers (manifest bump, changelog), tested in test/
```

Safety rules of this integration (TODO.md, "Decisions"): every command is
behind its own option, off by default (room setpoint 4-27 °C, control mode
Heating / Auto, hot water setpoint under a cap of 55 °C by default and 60 °C
at most, plus the thermostat's own bounds; refused outside, never clamped);
the thermostat is read again just before acting, nothing is sent past 3.5 s,
an update is never sent twice, the read 5 s later is the only confirmation;
never a `switch` feature; never a read sooner than 60 s after the last one
(`dueAt(mono)` on the monotonic clock, one read of the clock per decision);
logs carry codes, never the text of an answer nor the pairing identity.

## Rules

- **External ids are forever.** Build them with
  `gladys.externalIds(type, platformId)`, `platformId` being the unique id the
  platform gives the device (serial, cloud id, MAC), never a label. Here:
  `thermostat:<device_id>` and `boiler:<device_id>`, the `status.device_id`
  the thermostat answers. Gladys keys devices, their history, scenes and
  dashboards on them: changing one creates a new device and orphans the old
  one. The same goes for every key users store: manifest `config_schema`,
  `actions`, feature keys.
- **The container rootfs is read-only.** Write only under `/data`, the one
  writable volume (`atag-state.json`, 0600). Never log answers of the
  thermostat nor the pairing identity.
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or in the manifest, nor the `docker_image` tag,
  by hand (0.1.0 was set once, before the first release).
  `test/manifest.test.js` checks they agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]`
  in `CHANGELOG.md` (`### Added`, `Changed`, `Fixed`, `Removed`, `Security`).
  Never write a version heading: the Release workflow moves the section, and it
  becomes the notes of the GitHub Release.
- **Manifest.** Texts are multi-language objects `{ "en": ..., "fr": ... }`:
  `label`, `description` and `placeholder` alike, never a plain string. The
  catalog `description` holds 10 to 100 characters per language.
  `test/manifest.test.js` ties the manifest to the code (defaults, action
  handlers): change both sides together.
- **Units.** Only those the core lists for the category
  (`DEVICE_FEATURE_UNITS_BY_CATEGORY` of `server/utils/constants.js`); units
  and types are fixed when the device is created. `supported_options[].label`
  is a string.
- **Clocks.** `now` (wall) only for /data; `monotonic` for the pace, retries,
  backoff and freshness; a decision reads the clock once and passes the
  instant along. Tests use a clock that moves at every read, plus one real
  clock test.
- **User-facing text** is bilingual (English and French): action messages,
  manifest texts, and `docs/en.md` / `docs/fr.md`, kept in sync. Files are
  UTF-8 without BOM (`test/encoding.test.js`).
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network (loopback only).
