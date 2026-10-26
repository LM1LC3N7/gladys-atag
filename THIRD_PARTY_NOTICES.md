# Third-party notices

This integration ports to JavaScript the logic of the projects below for
talking to the Atag One thermostat. Nothing of them is installed at runtime:
they are Python, this integration is JavaScript.

## pyatag

<https://github.com/MatsNl/pyatag> (read at commit `4802df2`, 2023-10-09,
version 0.3.7.1), licensed under the MIT License.

Ported in `src/atag/client.js`, `src/atag/parse.js` and `src/i18n.js`: the
paths of the thermostat (`/pair`, `/retrieve`, `/update` on port 10000), the
shape of the messages (`pair_message`, `retrieve_message` with `info` 71,
`update_message` with `account_auth` and `control`), the `mac_address`
identity of the client in the `AA-BB-CC-DD-EE-FF` format, the meaning of
`acc_status` (2: authorized), the one-second spacing between requests and
the retry on a connection the thermostat closes, the bits of `boiler_status`
(8 burner, 4 hot water, 2 heating), and the tables of `ch_mode`,
`ch_control_mode`, `dhw_mode`, `weather_status` and `temp_unit`. The
`X-OneApp-Version` header and the `User-Agent` of the library are not
reproduced: this integration sends its own.

The `LICENSE.txt` of the project is the MIT template with its placeholder
left as it is; it is reproduced here exactly:

```
MIT License

Copyright (c) 2018 YOUR NAME

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Home Assistant, `atag` integration

<https://github.com/home-assistant/core/tree/dev/homeassistant/components/atag>
(read on the `dev` branch, 2026-10-25), licensed under the Apache License,
Version 2.0. The full text of the license is the `LICENSE` file of this
repository (the same Apache License 2.0).

Followed, without copying code: the reading every 60 seconds, the heating
action from the `ch` bit of `boiler_status`, the two HVAC modes (auto, heat)
mapped on `ch_control_mode`, the hot water bounds from `dhw_min_set` /
`dhw_max_set`, and the sensors shown (outside temperature and average,
weather, pressure, flow and return temperatures, burning hours, flame). The
test fixture of `tests/components/atag/__init__.py` (`RECEIVE_REPLY`) is
reproduced in `test/parse.test.js` and extended in
`test/helpers/fakeThermostat.js`.

```
Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```

## LM1LC3N7/gladys-incomfort and LM1LC3N7/gladys-iskra

The structure of the app, the handler wiring, the retry policy, the command
checks and the pacing on a monotonic clock follow integrations of the same
author, under the Apache License 2.0 of this repository.
