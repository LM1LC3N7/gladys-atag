// -----------------------------------------------------------------------------
// The HTTP transport on a real loopback server: one POST of JSON, bounded in
// size and time, a closed connection told apart, nothing sent when the
// connection is not up in time.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import { CODES } from '../src/atag/errors.js';
import { httpPost } from '../src/atag/http.js';

async function serve(handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    url: (path) => `http://127.0.0.1:${port}${path}`,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(resolve);
      }),
  };
}

test('a POST of JSON with our headers; the answer as bytes, any status', async () => {
  const seen = [];
  const server = await serve((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body: chunks.join('') });
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end('{"a":1}');
    });
  });
  try {
    const sent = [];
    const response = await httpPost(server.url('/retrieve'), {
      body: '{"x":1}',
      headers: { 'user-agent': 'gladys-atag test' },
      timeout: 2000,
      maxBytes: 1024,
      onSent: () => sent.push(true),
    });
    assert.equal(response.status, 404);
    assert.equal(response.body.toString(), '{"a":1}');
    assert.equal(seen[0].method, 'POST');
    assert.equal(seen[0].body, '{"x":1}');
    assert.equal(seen[0].headers['content-type'], 'application/json');
    assert.equal(seen[0].headers['user-agent'], 'gladys-atag test');
    assert.equal(seen[0].headers.connection, 'close');
    assert.deepEqual(sent, [true]);
  } finally {
    await server.close();
  }
});

test('an answer above the size cap is cut and refused', async () => {
  const server = await serve((req, res) => {
    res.writeHead(200);
    res.end(Buffer.alloc(200_000, 0x31));
  });
  try {
    await assert.rejects(
      httpPost(server.url('/retrieve'), { body: '{}', timeout: 2000, maxBytes: 64 * 1024 }),
      (err) => err.code === CODES.TOO_LARGE,
    );
  } finally {
    await server.close();
  }
});

test('no answer in time: a timeout, the socket destroyed', async () => {
  const server = await serve(() => {});
  try {
    await assert.rejects(
      httpPost(server.url('/retrieve'), { body: '{}', timeout: 100, maxBytes: 1024 }),
      (err) => err.code === CODES.TIMEOUT && !err.notSent,
    );
  } finally {
    await server.close();
  }
});

test('a connection the server closes without answering is a reset', async () => {
  const server = await serve((req) => req.socket.destroy());
  try {
    await assert.rejects(
      httpPost(server.url('/retrieve'), { body: '{}', timeout: 2000, maxBytes: 1024 }),
      (err) => err.code === CODES.RESET,
    );
  } finally {
    await server.close();
  }
});

/** A loopback port nothing listens on (taken by a server closed at once). */
async function freePort() {
  const probe = createTcpServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

test('nothing listening: unreachable, not sent; not HTTP: a bad answer', async () => {
  const port = await freePort();
  await assert.rejects(
    httpPost(`http://127.0.0.1:${port}/retrieve`, { body: '{}', timeout: 2000, maxBytes: 1024 }),
    (err) => err.code === CODES.UNREACHABLE && err.notSent === true && !/127\.0/.test(err.message),
  );
  const sockets = new Set();
  const tcp = createTcpServer((socket) => {
    sockets.add(socket);
    socket.end('nope\r\n\r\n');
  });
  await new Promise((resolve) => tcp.listen(0, '127.0.0.1', resolve));
  try {
    await assert.rejects(
      httpPost(`http://127.0.0.1:${tcp.address().port}/retrieve`, {
        body: '{}',
        timeout: 2000,
        maxBytes: 1024,
      }),
      (err) => err.code === CODES.BAD_ANSWER,
    );
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => tcp.close(resolve));
  }
});

test('sendWithin: a connection not up in time sends nothing', async () => {
  // A documentation address (TEST-NET-1): the SYN goes nowhere, or the
  // network has no route to it at all. Either way nothing was sent.
  await assert.rejects(
    httpPost('http://192.0.2.1:10000/update', {
      body: '{}',
      timeout: 500,
      sendWithin: 50,
      maxBytes: 1024,
    }),
    (err) => (err.code === CODES.TIMEOUT || err.code === CODES.UNREACHABLE) && err.notSent === true,
  );
  // Connected in time: sendWithin changes nothing.
  const server = await serve((req, res) => {
    res.writeHead(200);
    res.end('{}');
  });
  try {
    const response = await httpPost(server.url('/update'), {
      body: '{}',
      timeout: 2000,
      sendWithin: 1000,
      maxBytes: 1024,
    });
    assert.equal(response.status, 200);
  } finally {
    await server.close();
  }
});
