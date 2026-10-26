# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- First version: the Atag One thermostat through its local HTTP interface
  (port 10000), ported from pyatag. The pairing is confirmed once on the
  screen of the thermostat (asked again 1 to 15 min while not confirmed).
- One device for the thermostat (room temperature, setpoint, control mode,
  heating, program, outside temperature and average, weather) and one for
  the boiler (flow and return temperatures, pressure, burner, modulation,
  hot water temperature, setpoint, production and mode, burner hours,
  status in words), read every 60 seconds, never sooner whatever asks.
- Three commands, each behind its own option, off by default: the room
  setpoint (4 to 27 °C), the control mode (Heating / Auto), the hot water
  setpoint (under a cap of 55 °C by default, 60 °C at most, and the
  thermostat's own bounds). Decided on a fresh read, nothing sent past
  3.5 s, confirmed by the read 5 s later.
- A report whose own time stops moving for 2 hours is no longer published.
- "Test the connection" button; documentation in English and French.

[Unreleased]: https://github.com/LM1LC3N7/gladys-atag/commits/main
