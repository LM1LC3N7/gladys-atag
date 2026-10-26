# TODO — Atag One v1

Handoff document: what is done, what was decided, what comes next. Keep it
up to date at the end of every milestone.

## Working method

- One milestone at a time, one commit per milestone, tests green before moving on.
- After each milestone: `gi ci` (Prettier, ESLint, tests on Node 24 and 22,
  Docker build, store validator), `npm audit --omit=dev`, then update README,
  `docs/en.md`, `docs/fr.md`, `CHANGELOG.md` and this file.
- The `gladys-assistant-integration` topic is added at the first real release
  only. No forum topic of its own: the claim is in /t/10385 (lot 16).

## Status

- [x] **Milestone 1 — core** (2026-10-25): local client of the Atag One
      (`/pair`, `/retrieve`, `/update` on port 10000), ported from pyatag;
      pairing confirmed on the screen of the thermostat, asked again 1 to
      15 min; one device for the thermostat (room temperature, setpoint,
      control mode, heating, program, outside temperatures, weather), one for
      the boiler (flow / return temperatures, pressure, burner, modulation,
      hot water temperature / setpoint / production / mode, burner hours,
      status in words); reading every 60 s on a monotonic clock, never
      sooner whatever asks (test button, Discovery, reconnection, restart:
      the time of the last read kept in /data); thermostat unreachable
      retried 1 to 10 min; freshness on `report_time` (2 h); three commands
      behind three options (off by default): room setpoint 4-27 °C, control
      mode Heating / Auto, hot water setpoint under a cap (55 °C by default,
      60 at most) and the thermostat's bounds; fresh read before acting,
      3.5 s budget, answer at 4.3 s at most, confirmation by the read 5 s
      later; "Test the connection"; docs en/fr. Tested with unit tests
      against the SDK's fake Gladys and a fake thermostat (in memory and on
      loopback), a real-clock test (×100), the decoding against the Home
      Assistant fixture. **Never tested on a real thermostat.**
- [ ] **Milestone 2 — real thermostat** (a tester with an Atag One): record
      real answers as fixtures (device id anonymized), fix what differs. To
      check first:
  - whether the thermostat accepts a client without the `X-OneApp-Version`
    header and with a User-Agent other than the one of pyatag (this
    integration sends `gladys-atag (+https://github.com/LM1LC3N7/gladys-atag)`,
    never the identity of an app); if the thermostat refuses, say it on the
    forum and ask Louis before changing anything;
  - whether a `mac_address` that is not a real MAC of the host is accepted
    for the pairing (pyatag sends the MAC of the host; this integration draws
    a locally administered one once and keeps it in /data);
  - how the pairing request shows on the screen and how long it stays;
    whether a pairing request every minute is a nuisance (then widen the
    backoff);
  - the real bounds of the room setpoint (4 to 27 °C taken from the manual of
    the Atag One; the thermostat may accept more);
  - whether `ch_mode_temp` set while the program is `automatic` becomes a
    temporary override or is refused; whether the thermostat wants whole or
    half degrees;
  - the meaning of `dhw_mode_temp` (`% 150` in pyatag) against
    `dhw_temp_setp`: this version publishes `dhw_temp_setp` as the hot water
    setpoint;
  - `report_time` (seconds since 2000-01-01 on the thermostat's clock): how
    often it moves; the 2 h freshness rule assumes at least once an hour;
  - the time the thermostat takes to answer (10 s timeout per request, 3.5 s
    budget for the fresh read and the update of a command, 1 s spacing);
  - other `acc_status` values than 2 and 3.
- [ ] **SDK 0.16.0**: published on npm after this version was written
      (`npm view` gave 0.15.0 on 2026-10-25): migrate with the next wave,
      with `keywords` (atag, one, thermostat, boiler, chaudière, heating,
      chauffage, hot water) and `countries` (NL, BE, DE, GB, FR) and
      `gladys_version: ">=5.3.0"`; consider `poll_frequency` then.

## Decisions

- **Version**: 0.1.0 set by hand in `package.json`, `package-lock.json`, the
  manifest and the `docker_image` tag; the first Release (patch) gives 0.1.1.
- **SDK ^0.15.0**: the template asked for ^0.16.0, not on npm on 2026-10-25;
  pinned back to ^0.15.0 (migration planned, see Status).
- **License**: Apache-2.0, the standard text (no person named), shipped in the
  image with `THIRD_PARTY_NOTICES.md` (full MIT notice of pyatag with its
  "YOUR NAME" placeholder as it is, Apache-2.0 of Home Assistant).
- **No `keywords` / `countries`** in the manifest: they need
  `gladys_version >= 5.3.0`, released on 2026-10-25, which would block the
  installation on every instance not yet updated; listed in Status for the
  migration wave.
- **Two devices**: the thermostat (room side) and the boiler (boiler and hot
  water), both keyed by `status.device_id` (`thermostat:<id>`,
  `boiler:<id>`); the Thermostat service of the core works on the first, the
  water-heater features live on the second. A device id must be 4 to 48
  letters, digits, `-` or `_`.
- **Identity of the client**: pyatag sends the MAC of the host; in a
  container it would be the one of the bridge, shared with other
  integrations and changing. A locally administered unicast MAC is drawn once
  (`newMac`) and kept in `/data/atag-state.json` (0600). It is the pairing
  credential: never logged. /data lost: a new identity, the thermostat asks
  to confirm again.
- **Pairing**: sent at the first read of a client and whenever a reply says
  `acc_status != 2`; while not confirmed, asked again after 1, 2, 4, 8,
  15 min (kept in /data, so a restart does not hurry it), lifted by a user
  action (saved configuration, test button) but never a read sooner than
  60 s after the last one. No code, no e-mail: the confirmation happens on
  the thermostat's own screen.
- **Our own User-Agent** (`gladys-atag (+https://github.com/LM1LC3N7/gladys-atag)`),
  no `X-OneApp-Version`: no imitation of an app nor of the library.
- **Pace**: 60 s (Home Assistant), global and kept across restarts (the time
  of the last read in /data, written at most once a minute and at a clean
  stop); the test button, Discovery, `connected`, a saved configuration never
  read sooner. Monotonic clock for the pace, the retries, the pairing backoff
  and the freshness (`dueAt(mono)` on the caller's instant); wall clock for
  /data only. One timer at a time; the confirming read of a command restarts
  the pace from itself.
- **Retries**: thermostat unreachable 1 min doubling to 10 min; a connection
  the thermostat closes during a read tried 3 times at once (pyatag: 10),
  never an update. 429 / 5xx: no special pause, the same retry (a LAN device
  without rate limiting known).
- **Freshness**: `report_time` of the thermostat; unchanged for 2 h on the
  monotonic clock: states not published, badge degraded with a message,
  status says it. The SDK heartbeat (30 min) republishes unchanged values
  only within those 2 h.
- **Identity checked at every read and before every command**: another
  `device_id` at the address: created devices unreachable, the new one in
  Discovery; a command for another id sends nothing.
- **Room setpoint 4-27 °C by half degrees**: the dial of the Atag One (to
  confirm on a real device, Milestone 2); refused outside, never clamped;
  the raw value checked before rounding; `ch_mode_temp` sent, converted to
  °F when the thermostat is in Fahrenheit.
- **Control mode**: THERMOSTAT_MODE.HEATING (1) → `ch_control_mode` 1,
  AUTO (3) → 0; OFF refused with a message (the thermostat has no off; "the
  stop is never blocked" has nothing to block here). `supported_options`
  with string labels, checked against the core's
  `normalizeSupportedOptions` when the clone is at hand.
- **Program (`ch_mode`) read only** as text: the core's THERMOSTAT_PRESET
  has no manual / extend / fireplace, and `vacation` needs a start and a
  duration (pyatag sends one day): a later version may offer presets.
- **Hot water setpoint**: `dhw_temp_setp`, between `dhw_min_set` (else
  30 °C) and `min(dhw_max_set, cap)`, the cap being the `dhw_max` option
  (55 °C by default, never above 60 °C whatever is entered: an invalid cap
  is said in the status and 55 is used). Hot water mode (Comfort / Eco) read
  only; no boost, no switch.
- **Commands**: serialized, fresh `retrieve` within the budget (3.5 s from
  the command, 1.5 s needed to start, 0.6 s kept for the update), option
  checked at arrival and before sending, Gladys answered at 4.3 s at most
  ("sent, the thermostat has not answered yet"), an update never retried (it
  may have been applied), the read 5 s later the only confirmation. The
  fresh report is published in the background (never delays the answer).
- **Fahrenheit**: temperatures converted to °C in `parseReport` (one
  decimal), commands converted back (`toDeviceUnit`); tested with real
  values (68 °F = 20 °C, 69.8 °F = 21 °C, 122 °F = 50 °C).
- **Units**: °C for temperatures and setpoints, bar for the pressure, hours
  for the burner (`duration`/`integer`), no unit for the modulation
  (`unknown`/`decimal`, "%" in the name), the mode, the operating state and
  the hot water production (enums of the core).
- **Water and outside temperatures as probes** (`temperature-sensor`/`probe`):
  the core keeps them out of the room temperature; the room temperature is
  `decimal`.
- **Status, program, weather, hot water mode as text** (`text`/`text`, read
  only, no history), in the language of the configuration (French by
  default).
- **No UDP discovery** (pyatag listens on port 11000 for a broadcast): the
  address is typed in; `scanNetwork('udp-broadcast')` of the SDK could
  replace it later.
- **Logs**: codes and HTTP statuses only, never the body of an answer nor
  the pairing identity; the address once at start.
- **Configuration unreadable on `connected`**: asked again 3 times (30 s,
  60 s, 120 s), then an error is logged.

## Ideas (not planned)

- Presets (schedule / vacation) once the core's THERMOSTAT_PRESET fits.
- UDP discovery through `scanNetwork`.
- `poll_frequency` with the SDK 0.16 migration (the core calls `device.poll`).
