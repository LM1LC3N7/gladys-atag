# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Changed

- Hot water ceiling raised to 65 °C (default 65 °C), device limits still apply.

## [0.1.2] - 2026-10-26

### Changed

- Integration SDK 0.16 (no change for the devices).

## [0.1.1] - 2026-10-26

### Added

- First version: the Atag One thermostat through its local HTTP interface
  (port 10000), ported from pyatag. The pairing is confirmed once on the
  screen of the thermostat (asked only when the thermostat refuses Gladys,
  again 1 to 15 min later, 8 times at most, then with the test button).
- One device for the thermostat (room temperature, setpoint, control mode,
  heating, program, outside temperature and average, weather) and one for
  the boiler (flow and return temperatures, pressure, burner, modulation,
  hot water temperature, setpoint, production and mode, burner hours,
  status in words), read by the loop every 60 seconds.
- Three commands, each behind its own option, off by default: the room
  setpoint (4 to 27 °C), the control mode (Heating / Auto), the hot water
  setpoint (under a cap of 55 °C by default, 60 °C at most, and the
  thermostat's own bounds, not on a thermostat set to Fahrenheit). Decided on
  a fresh read, nothing sent past 3.5 s, confirmed by the read 5 s later; 6
  commands of a kind per minute at most.
- A report whose own time stops moving for 2 hours is no longer published.
- "Test the connection" button; documentation in English and French.

[Unreleased]: https://github.com/LM1LC3N7/gladys-atag/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/LM1LC3N7/gladys-atag/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/LM1LC3N7/gladys-atag/releases/tag/v0.1.1
