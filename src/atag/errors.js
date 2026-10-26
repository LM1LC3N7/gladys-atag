// -----------------------------------------------------------------------------
// ThermostatError: every failure of a request to the Atag One, with a code the
// app maps to a status, a retry policy or a message. Messages are built here
// from codes and HTTP statuses only: never the text of an answer.
// -----------------------------------------------------------------------------

export const CODES = Object.freeze({
  UNREACHABLE: 'unreachable', // no TCP connection
  RESET: 'reset', // the thermostat closed the connection (it does, often)
  TIMEOUT: 'timeout', // no answer in time
  HTTP: 'http', // an HTTP status other than 2xx (see `status`)
  BAD_ANSWER: 'bad_answer', // not the JSON expected
  TOO_LARGE: 'too_large', // answer above the size cap
  UNAUTHORIZED: 'unauthorized', // the pairing is not confirmed on the screen of the thermostat
  CLOSED: 'closed', // the client was replaced (new configuration)
  NO_TIME: 'no_time', // the deadline of a command left no room: not sent
});

export class ThermostatError extends Error {
  constructor(code, message, { status, accStatus } = {}) {
    super(message);
    this.name = 'ThermostatError';
    this.code = code;
    if (status !== undefined) this.status = status;
    if (accStatus !== undefined) this.accStatus = accStatus;
  }
}

/** The thermostat has not (or no longer) accepted the pairing. */
export const isUnauthorized = (err) => err?.code === CODES.UNAUTHORIZED;
