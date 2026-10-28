# gladys-atag

[Gladys Assistant](https://gladysassistant.com) external integration for the
**Atag One** thermostat (Atag boilers) through its local HTTP interface (port
10000): the thermostat becomes a Gladys device (room temperature, setpoint,
control mode, heating, program, outside temperatures, weather), the boiler
another (flow and return temperatures, pressure, burner, modulation, hot water
temperature and setpoint, hot water production and mode, burner hours,
status). Three commands, each behind its own option, off by default: the room
setpoint, the control mode, the hot water setpoint (capped). Local, no cloud.
**Unofficial integration, not affiliated with Atag. Never tested on a real
thermostat yet.**

User documentation: [docs/en.md](docs/en.md) · [docs/fr.md](docs/fr.md).

## How it works

```
Gladys ⇄ SDK ⇄ src/app.js (AtagApp)
                 ├─ src/atag/client.js   /pair, /retrieve, /update; one request a second
                 ├─ src/atag/http.js     the only network access (node:http, plain HTTP POST)
                 ├─ src/atag/parse.js    answers -> plain objects (ported from pyatag)
                 ├─ src/atag/errors.js   error codes, pairing refused
                 ├─ src/publisher.js     states per minute (300/min limit of Gladys)
                 ├─ src/store.js         /data: the client identity, the last read, the pairing
                 └─ src/devices.js       thermostat and boiler devices (pure)
```

- **Thermostat**: `POST /retrieve` every 60 s; `POST /pair` only when the
  thermostat says this client is not accepted (the user confirms "Gladys" on
  its screen), 8 automatic requests at most, then only a user action sends
  one. The client identity (`mac_address`) is drawn once and kept in `/data`;
  a `/data` that cannot be read is never rewritten and nothing is sent.
  External ids: `thermostat:<device_id>`, `boiler:<device_id>`.
- **Pace**: the loop, the test button, Discovery, a reconnection and a
  restart never read sooner than 60 s after the last read (its time kept in
  `/data` at every read), on a monotonic clock; a command adds its fresh read
  and its confirming read. The pairing not confirmed is asked again 1 to
  15 min later; the thermostat unreachable retried 1 to 10 min later.
- **Freshness**: a report read more than 2 min ago is not published again; a
  report whose `report_time` stops moving for 2 h is not published (badge
  degraded, kept across a restart); a value outside the bounds of its feature
  is not published. Another `device_id` at the address: the created
  devices turn unreachable, the new one goes to Discovery.
- **Commands** (`allow_setpoint`, `allow_mode`, `allow_dhw_setpoint`, all off
  by default): the room setpoint 4 to 27 °C, the control mode Heating / Auto
  (the local interface offers no "off"), the hot water setpoint between the
  thermostat's bounds (required) and under the user's cap (65 °C by default,
  65 °C at most), not on a thermostat in Fahrenheit; refused outside, not
  clamped. The thermostat is read again just before acting; nothing leaves
  past 3.5 s after the command, the exchange then gets 10 s; Gladys is
  answered 4.3 s after the command at the latest; the read 5 s later is the
  only confirmation. Commands run one after the other; a command held behind
  an unanswered one is refused at once with that reason; 6 raises or mode
  changes per minute at most, lowerings never held back. No feature is a
  switch.
- **Reconnection to Gladys**: Discovery, badges, status and the fresh states
  are published again; the client, the pairing state and the pace stay. The
  configuration Gladys does not give is asked again without end (10 min at
  most between two tries).

## Development

```bash
npm install
npm test                                        # node --test, no network (loopback only)
npm run lint && npm run format:check
npm run audit                                   # production dependencies
npm run cover                                   # regenerate cover.png
npx github:GladysAssistant/integration-store .  # store admission checks
```

The tests run against the SDK's fake Gladys and a fake thermostat
(`test/helpers/fakeThermostat.js`, in memory and on loopback), on a virtual
clock that moves at every read of it, plus one test on the real clock (sped
up 20 times). No test touches a real thermostat or the Internet. The
decoding is checked against the test fixture of Home Assistant.

## Credits

- [pyatag](https://github.com/MatsNl/pyatag) (MIT): the protocol of the
  thermostat, ported to JavaScript (see
  [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)).
- The `atag` integration of
  [Home Assistant](https://github.com/home-assistant/core) (Apache-2.0): the
  reading interval, the modes and the sensors shown.
- [gladys-incomfort](https://github.com/LM1LC3N7/gladys-incomfort) and
  [gladys-iskra](https://github.com/LM1LC3N7/gladys-iskra): the structure of
  the app, the command checks and the pacing on a monotonic clock.

## Releasing

**Actions → Release → Run workflow** (patch / minor / major): bumps the
version in `package.json` and the manifest, rolls `CHANGELOG.md`, tags, builds
the multi-arch image to GHCR and publishes the GitHub Release.
