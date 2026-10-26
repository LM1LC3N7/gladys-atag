# Atag One

Your **Atag One** thermostat (Atag boilers) in Gladys, through its local
interface on your network (port 10000), without any cloud:

- the thermostat becomes a Gladys device: **room temperature**, **setpoint**,
  **control mode** (Heating, or Auto following the weather), **heating**,
  **program** (manual, schedule, vacation, extend, fireplace), **outside
  temperature** (and its average), **weather**;
- the boiler becomes another: **flow and return temperatures**, **water
  pressure** (bar), **burner on**, **burner modulation** (%), **hot water
  temperature**, **hot water setpoint**, **hot water production**, **hot water
  mode** (Comfort / Eco), **burner running hours** and its **status** in words
  (standby, heating, hot water).

> **This integration has never been tested on a real thermostat.** This first
> version was written from the pyatag library and the atag integration of
> Home Assistant, and tested only against a fake thermostat. Tell on the
> Gladys forum what works and what does not.

Unofficial integration, not affiliated with Atag.

## Configuration

- **Thermostat address**: its IP address on your network (`192.168.1.20`); a
  port may follow (`192.168.1.20:10000`, 10000 by default). Prefer the IP
  address: a `.local` (mDNS) name does not resolve inside the container of
  the integration. Give it a fixed address in your router. The thermostat
  only speaks plain http on this port: an `https://` address is refused with
  a clear message. No user name or password: the thermostat knows Gladys by
  the pairing below.
- **Pairing**: at the first read, the thermostat shows on its screen a
  pairing request in the name of "Gladys". Confirm it on the thermostat.
  Until it is confirmed, Gladys asks again (after 1 min, then 2, 4, 8, 15 min
  at most) and the status of the integration says so; saving the
  configuration or pressing **Test the connection** asks again at the next
  read (never more than one read a minute). The identity Gladys gives the
  thermostat is drawn at random once and kept in the data of the
  integration: if that data is lost, the thermostat asks for a confirmation
  again.
- **Commands**: three options, all off by default (see Commands).
- **Hot water cap (°C)**: the highest hot water setpoint Gladys may send,
  55 °C by default; never above 60 °C whatever is entered (a value outside
  30 to 60 °C is refused with a message and 55 °C stays in use).
- **Language of the devices**: French (default) or English, for the device
  names and the program, weather, hot water mode and status texts.

Then open the **Discovery** tab and create the thermostat and the boiler. The
**Test the connection** button asks the pairing again if needed, reads the
thermostat when the pace allows it (never more than once a minute) and
reports.

## Commands

By default Gladys only reads. Each option, once ticked, lets the dashboard,
the scenes, the voice assistants (Siri / HomeKit...) and the Thermostat
service of Gladys change one single thing:

- **Room setpoint** (`Allow changing the room setpoint`): from **4 to 27 °C**
  (the range of the dial of the Atag One), by half degrees; a value outside
  is refused, never clamped.
- **Control mode** (`Allow changing the control mode`): **Heating** (regular
  control, value 1) or **Auto** (weather-dependent, value 3). This thermostat
  has no "off" mode: the value 0 is refused with a message. The program
  (manual, vacation...) is read only in this version.
- **Hot water setpoint** (`Allow changing the hot water setpoint`): between
  the minimum and the maximum the thermostat announces, and under the cap of
  the configuration (55 °C by default, 60 °C at most); a value outside is
  refused, never clamped.

No feature is a switch: "turn everything off" cannot act on the boiler nor
on the hot water.

For each command:

- Just before acting, Gladys reads the thermostat again. Nothing is sent in
  the following cases: the option is unticked (checked when the command
  arrives and again just before sending); the value is out of bounds; the
  pairing is not confirmed; the read fails or exceeds the time budget;
  another thermostat answers at the address; the configuration changed
  meanwhile; the value is already the one asked (the command then succeeds
  without sending).
- When the command cannot be checked within 3.5 s, nothing is sent and
  Gladys shows a failure (no action after a failure was shown). Once sent,
  Gladys answers at most 4.3 s after your command.
- The value shown only changes at the **read 5 s after the sending**: that
  read confirms the command. If the thermostat did not apply it, the value
  shown stays the old one.
- Commands run one after the other (one thermostat), and every request to
  the thermostat is at least one second apart (it drops faster callers).

## Refresh and limits

- The thermostat is read every **60 seconds**. The states are thus up to one
  minute late. Only the values that change are sent to Gladys (and each one
  at least every 30 minutes). Nothing reads it more often: neither the test
  button, nor Discovery, nor a reconnection to Gladys, nor a restart of the
  integration (the time of the last read is kept).
- Every report of the thermostat carries its own time. When it stops moving
  for more than 2 hours, the values are no longer published (they would be
  stale), the badge of the devices turns "degraded" and the status says so;
  everything resumes as soon as the report moves.
- The water and outside temperatures are probes: Gladys keeps them out of the
  temperature of the room the thermostat is in.
- A thermostat set to Fahrenheit is read and commanded in °C (converted).
- The thermostat is known by its **identifier** (`status.device_id`), not by
  its address: when another thermostat answers at the address, the created
  devices turn unreachable and the new one shows up in Discovery.

## Connection problems

- **Pairing to confirm**: see Configuration. A report with the pairing lost
  (the thermostat removed Gladys) goes back to the pairing.
- **Thermostat unreachable**: every device shows unreachable; a new try after
  1 min, then more and more rarely up to every 10 min (never faster than the
  normal read). A connection the thermostat closes during a read is tried
  again (3 tries); a command is never sent again (it may have been applied:
  the read tells).
- **This address does not answer like an Atag One**: check the address and
  the port (10000 by default).
- The logs carry no text of the answers of the thermostat, only codes (HTTP
  500, no connection...), nor the pairing identity.

## Limits

- One thermostat per integration; the address is typed in (no automatic
  discovery on the network).
- The program (manual, vacation...) and the hot water mode (Comfort / Eco)
  are read only.
- Never tested on a real thermostat.
