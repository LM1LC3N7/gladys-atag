// -----------------------------------------------------------------------------
// A fake Atag One (in memory, or on loopback through listen()): the local
// HTTP interface the integration uses. The shapes come from pyatag (MIT) and
// the test fixtures of the Home Assistant `atag` integration (Apache-2.0);
// never checked against a real thermostat (TODO.md).
// -----------------------------------------------------------------------------

import http from 'node:http';
import { CODES, ThermostatError } from '../../src/atag/errors.js';

/** The JSON of a request body, or null. */
const parse = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

export const DEVICE_ID = '6808-1401-3109_15-30-001-544';
export const OTHER_DEVICE_ID = '6808-1401-3109_15-30-001-999';
export const AUTHORIZED = 2;
export const UNAUTHORIZED = 3;

/** The retrieve_reply of a thermostat (Home Assistant test fixture, extended). */
export function retrieveReply({
  deviceId = DEVICE_ID,
  accStatus = AUTHORIZED,
  reportTime = 843_000_000,
  roomTemp = 20.5,
  outsideTemp = 15,
  dhwWaterTemp = 30,
  chWaterTemp = 40,
  chWaterPres = 1.8,
  chReturnTemp = 35,
  boilerStatus = 0,
  toutAvg = 12,
  relModLevel = 0,
  burningHours = 1000,
  chControlMode = 0,
  chMode = 2,
  chModeTemp = 20,
  dhwTempSetp = 50,
  dhwMode = 1,
  weatherStatus = 8,
  tempUnit = 0,
  dhwMaxSet = 65,
  dhwMinSet = 40,
} = {}) {
  return {
    retrieve_reply: {
      seqnr: 0,
      status: { device_id: deviceId, device_status: 16385, connection_status: 23, date_time: 0 },
      report: {
        report_time: reportTime,
        burning_hours: burningHours,
        room_temp: roomTemp,
        outside_temp: outsideTemp,
        dhw_water_temp: dhwWaterTemp,
        ch_water_temp: chWaterTemp,
        ch_water_pres: chWaterPres,
        ch_return_temp: chReturnTemp,
        boiler_status: boilerStatus,
        tout_avg: toutAvg,
        details: { rel_mod_level: relModLevel, boiler_temp: chWaterTemp },
      },
      control: {
        ch_control_mode: chControlMode,
        ch_mode: chMode,
        ch_mode_duration: 0,
        ch_mode_temp: chModeTemp,
        dhw_temp_setp: dhwTempSetp,
        dhw_mode: dhwMode,
        dhw_mode_temp: 150,
        weather_status: weatherStatus,
      },
      configuration: {
        download_url: 'http://firmware.atag-one.com:80/R58',
        temp_unit: tempUnit,
        dhw_max_set: dhwMaxSet,
        dhw_min_set: dhwMinSet,
      },
      acc_status: accStatus,
    },
  };
}

export function createFakeThermostat(options = {}) {
  const fake = {
    deviceId: DEVICE_ID,
    /** The pairing: `pending` until the user confirms on the screen. */
    pending: false,
    /** What the thermostat reports (the options of retrieveReply). */
    report: { ...options },
    requests: [],
    updates: [],
    /** path -> { status, body } answered once (a failure to script). */
    failures: [],
    /** Every connection refused. */
    unreachable: false,
    /** This many next connections closed by the thermostat (ECONNRESET). */
    resets: 0,
    /** A promise the update requests wait for before answering (a slow thermostat). */
    updateGate: null,
    /** A promise every request waits for (a slow thermostat). */
    gate: null,
    /** The raw text answered instead of JSON. */
    rawBody: null,
    /** The timers of the test: the transport timeout is then honoured. */
    timers: null,
  };

  const json = (status, value) => ({
    status,
    headers: { 'content-type': 'application/json' },
    body: Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)),
  });
  const status = () => (fake.pending ? UNAUTHORIZED : AUTHORIZED);

  async function answer(path, body) {
    if (fake.gate) await fake.gate;
    const failure = fake.failures.findIndex((f) => path === f.path);
    if (failure !== -1) {
      const [f] = fake.failures.splice(failure, 1);
      return json(f.status, f.body ?? '<html>remote text</html>');
    }
    if (fake.rawBody !== null) return json(200, fake.rawBody);
    const message = body?.[`${path.slice(1)}_message`];
    const mac = message?.account_auth?.mac_address;
    if (!message || typeof mac !== 'string') return json(400, 'Bad request');
    if (path === '/pair') {
      return json(200, {
        pair_reply: { status: { device_id: fake.deviceId }, acc_status: status() },
      });
    }
    if (path === '/retrieve') {
      return json(
        200,
        retrieveReply({ ...fake.report, deviceId: fake.deviceId, accStatus: status() }),
      );
    }
    if (path === '/update') {
      fake.updates.push(message.control);
      if (fake.updateGate) await fake.updateGate;
      if (status() === AUTHORIZED) {
        const control = message.control ?? {};
        if ('ch_mode_temp' in control) fake.report.chModeTemp = control.ch_mode_temp;
        if ('ch_control_mode' in control) fake.report.chControlMode = control.ch_control_mode;
        if ('dhw_temp_setp' in control) fake.report.dhwTempSetp = control.dhw_temp_setp;
      }
      return json(200, {
        update_reply: { status: { device_id: fake.deviceId }, acc_status: status() },
      });
    }
    return json(404, 'Not found');
  }

  /** The transport of src/atag/http.js, in memory. */
  fake.request = async (rawUrl, options = {}) => {
    const url = new URL(rawUrl);
    const body = parse(options.body);
    fake.requests.push({
      url: rawUrl,
      path: url.pathname,
      headers: options.headers ?? {},
      body,
      timeout: options.timeout,
      sendWithin: options.sendWithin,
    });
    if (fake.unreachable) {
      const err = new ThermostatError(CODES.UNREACHABLE, 'ECONNREFUSED');
      err.notSent = true;
      throw err;
    }
    if (fake.resets > 0) {
      fake.resets -= 1;
      const err = new ThermostatError(CODES.RESET, 'Connection closed (ECONNRESET)');
      err.notSent = true;
      throw err;
    }
    options.onSent?.();
    const answered = answer(url.pathname, body);
    // The timeout of the transport, on the clock of the test when given.
    if (!fake.timers || !options.timeout) return answered;
    let id;
    const limit = new Promise((_, reject) => {
      id = fake.timers.setTimeout(
        () => reject(new ThermostatError(CODES.TIMEOUT, 'No answer in time')),
        options.timeout,
      );
    });
    try {
      return await Promise.race([answered, limit]);
    } finally {
      fake.timers.clearTimeout(id);
    }
  };

  /** The same interface on a loopback HTTP server: { origin, close }. */
  fake.listen = async () => {
    const server = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', async () => {
        const body = parse(Buffer.concat(chunks).toString('utf8'));
        fake.requests.push({ url: req.url, path: req.url, headers: req.headers, body });
        if (fake.resets > 0) {
          fake.resets -= 1;
          req.socket.destroy();
          return;
        }
        const result = await answer(req.url, body);
        res.writeHead(result.status, result.headers);
        res.end(result.body);
      });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    return {
      origin: `http://127.0.0.1:${port}`,
      port,
      close: () =>
        new Promise((resolve) => {
          server.closeAllConnections?.();
          server.close(resolve);
        }),
    };
  };

  return fake;
}
