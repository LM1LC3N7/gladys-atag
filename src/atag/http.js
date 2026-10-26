// -----------------------------------------------------------------------------
// The only network access of the integration: one plain HTTP POST of a JSON
// body to the thermostat on node:http (the Atag One speaks no TLS on its
// local port). A deadline for the whole exchange, a size cap on the body, no
// redirect followed, no keep-alive. Resolves { status, headers, body } for any
// status; rejects a ThermostatError for the transport failures. `sendWithin`:
// the connection must be up within this many ms, else nothing is written (a
// command never leaves late). `notSent` on an error means no byte left.
// -----------------------------------------------------------------------------

import http from 'node:http';
import { CODES, ThermostatError } from './errors.js';

/** The thermostat closes connections of its own: pyatag retries these. */
const RESET_CODES = new Set(['ECONNRESET', 'EPIPE']);

function transportError(err) {
  const code = String(err?.code ?? '');
  if (RESET_CODES.has(code) || /socket hang up/i.test(String(err?.message ?? ''))) {
    return new ThermostatError(CODES.RESET, `Connection closed (${code || 'hang up'})`);
  }
  // Something answered, but not in HTTP (a wrong port).
  if (code.startsWith('HPE_')) return new ThermostatError(CODES.BAD_ANSWER, `Not HTTP (${code})`);
  // Only the error code: a message may carry an address.
  return new ThermostatError(CODES.UNREACHABLE, code || 'Connection failed');
}

/**
 * @param {string} url absolute http URL
 * @param {object} options
 * @param {string} options.body the JSON text to post
 * @param {Record<string, string>} [options.headers]
 * @param {number} options.timeout ms for the whole exchange
 * @param {number} [options.sendWithin] ms to have the connection up, else not sent
 * @param {number} options.maxBytes body size cap
 * @param {() => void} [options.onSent] called once the request is written
 */
export function httpPost(url, { body, headers = {}, timeout, sendWithin, maxBytes, onSent } = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    let settled = false;
    let req = null;
    // Until the connection is up, nothing of the request has left: a failure
    // then is "not sent" for sure (see the commands).
    let connected = false;

    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(sendTimer);
      if (error) {
        if (!connected) error.notSent = true;
        req?.destroy();
        reject(error);
      } else {
        resolve(value);
      }
    };
    const timer = setTimeout(
      () =>
        finish(
          new ThermostatError(CODES.TIMEOUT, `No answer within ${Math.round(timeout / 1000)} s`),
        ),
      timeout,
    );
    const sendTimer =
      sendWithin === undefined
        ? null
        : setTimeout(() => {
            if (!connected) {
              finish(new ThermostatError(CODES.TIMEOUT, 'Not connected in time: request not sent'));
            }
          }, sendWithin);

    const markSent = () => {
      if (connected) return;
      connected = true;
      clearTimeout(sendTimer);
      onSent?.();
    };

    const payload = Buffer.from(body, 'utf8');
    try {
      req = http.request(
        {
          method: 'POST',
          host: target.hostname.replace(/^\[(.*)\]$/, '$1'),
          port: Number(target.port) || 80,
          path: `${target.pathname}${target.search}`,
          agent: false,
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            'content-length': payload.length,
            host: target.host,
            connection: 'close',
            ...headers,
          },
        },
        (res) => {
          markSent();
          const chunks = [];
          let size = 0;
          res.on('data', (chunk) => {
            size += chunk.length;
            if (size > maxBytes) {
              finish(new ThermostatError(CODES.TOO_LARGE, `Answer above ${maxBytes} bytes`));
              return;
            }
            chunks.push(chunk);
          });
          res.on('end', () =>
            finish(null, {
              status: res.statusCode,
              headers: res.headers,
              body: Buffer.concat(chunks),
            }),
          );
          res.on('error', (err) => finish(transportError(err)));
        },
      );
      req.on('socket', (socket) => {
        if (!socket.connecting) markSent();
        else socket.once('connect', markSent);
      });
      req.on('error', (err) => finish(transportError(err)));
      req.end(payload);
    } catch (err) {
      // http.request throws on a header it refuses: a failure, never a crash.
      finish(transportError(err));
    }
  });
}
