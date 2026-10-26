// -----------------------------------------------------------------------------
// Generates cover.png (800×534, the store size): a deep blue gradient, a
// round thermostat dial with its setpoint, a wall-hung boiler with its flame
// and a pressure gauge, linked by a network line. Plain Node (zlib), no
// dependency. Run: npm run cover
// -----------------------------------------------------------------------------

import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const WIDTH = 800;
const HEIGHT = 534;

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) {
    c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * Math.min(1, Math.max(0, t))));
const smooth = (edge, distance) => Math.min(1, Math.max(0, edge - distance + 0.5));

const NAVY = [14, 26, 48];
const TEAL = [16, 72, 92];
const WHITE = [242, 244, 248];
const STEEL = [190, 198, 210];
const DARK = [22, 30, 44];
const SCREEN = [20, 34, 52];
const CYAN = [80, 205, 230];
const ORANGE = [255, 138, 36];
const YELLOW = [255, 216, 96];
const RED = [228, 66, 58];

/** Distance from a point to a rounded rectangle (negative inside). */
function roundedBox(x, y, cx, cy, halfW, halfH, radius) {
  const qx = Math.abs(x - cx) - halfW + radius;
  const qy = Math.abs(y - cy) - halfH + radius;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
}

/** Distance to a segment. */
function segment(x, y, x0, y0, x1, y1) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const t = Math.min(1, Math.max(0, ((x - x0) * dx + (y - y0) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - (x0 + t * dx), y - (y0 + t * dy));
}

/** Segments of a seven-segment digit at (cx, cy), height h. */
function digit(value, cx, cy, h) {
  const w = h * 0.55;
  const t = cy - h / 2;
  const m = cy;
  const b = cy + h / 2;
  const l = cx - w / 2;
  const r = cx + w / 2;
  const segs = {
    a: [l, t, r, t],
    b: [r, t, r, m],
    c: [r, m, r, b],
    d: [l, b, r, b],
    e: [l, m, l, b],
    f: [l, t, l, m],
    g: [l, m, r, m],
  };
  const on = { 0: 'abcdef', 1: 'bc', 2: 'abged', 5: 'afgcd', 7: 'abc' }[value];
  return [...on].map((s) => segs[s]);
}

function pixel(x, y) {
  let color = mix(NAVY, TEAL, (x / WIDTH) * 0.5 + (y / HEIGHT) * 0.5);

  // The network line between the thermostat and the boiler.
  color = mix(color, CYAN, smooth(2, segment(x, y, 330, 262, 470, 262)) * 0.7);
  for (const dx of [360, 400, 440]) {
    color = mix(color, CYAN, smooth(4, Math.hypot(x - dx, y - 262)));
  }

  // The thermostat: a round dial with an orange arc and the setpoint "20.5".
  const stat = Math.hypot(x - 220, y - 262);
  color = mix(color, STEEL, smooth(122, stat));
  color = mix(color, WHITE, smooth(116, stat));
  const ring = Math.abs(stat - 96);
  const angle = Math.atan2(y - 262, x - 220);
  if (angle > -2.6 && angle < 1.1) color = mix(color, ORANGE, smooth(5, ring));
  else if (ring < 5) color = mix(color, STEEL, smooth(5, ring) * 0.5);
  color = mix(color, SCREEN, smooth(74, stat));
  const SEGMENTS = [
    ...digit(2, 186, 262, 52),
    ...digit(0, 226, 262, 52),
    ...digit(5, 272, 272, 34),
  ];
  for (const [x0, y0, x1, y1] of SEGMENTS) {
    color = mix(color, CYAN, smooth(3, segment(x, y, x0, y0, x1, y1)));
  }
  color = mix(color, CYAN, smooth(3, Math.hypot(x - 251, y - 286)));
  color = mix(color, CYAN, smooth(2, Math.hypot(x - 290, y - 250)));

  // The boiler: a white cabinet with a flame window and pipes.
  const boiler = roundedBox(x, y, 600, 262, 110, 170, 16);
  color = mix(color, STEEL, smooth(0, Math.abs(boiler) - 2));
  color = mix(color, WHITE, smooth(0, boiler + 2));
  const display = roundedBox(x, y, 600, 150, 64, 20, 5);
  color = mix(color, SCREEN, smooth(0, display));
  for (const [x0, y0, x1, y1] of [...digit(1, 586, 150, 22), ...digit(7, 614, 150, 22)]) {
    color = mix(color, CYAN, smooth(2, segment(x, y, x0, y0, x1, y1)));
  }
  const window = roundedBox(x, y, 600, 290, 56, 66, 28);
  color = mix(color, DARK, smooth(0, window));
  if (window < 0) {
    const fx = (x - 600) / 34;
    const fy = (y - 318) / 48;
    const flame = fx * fx + fy * fy * (fy < 0 ? 0.55 : 1.6);
    color = mix(color, ORANGE, smooth(1, flame * 26 - 20));
    const core = fx * fx * 2.4 + (fy + 0.15) ** 2 * (fy < -0.15 ? 1.1 : 3.2);
    color = mix(color, YELLOW, smooth(1, core * 26 - 18));
  }
  for (const px of [545, 585, 615, 655]) {
    const pipe = roundedBox(x, y, px, 462, 6, 28, 3);
    color = mix(color, STEEL, smooth(0, pipe));
  }

  // The pressure gauge on the boiler.
  const gauge = Math.hypot(x - 668, y - 400);
  color = mix(color, STEEL, smooth(24, gauge));
  color = mix(color, WHITE, smooth(20, gauge));
  color = mix(color, RED, smooth(2, segment(x, y, 668, 400, 680, 387)));
  return color;
}

const raw = Buffer.alloc((WIDTH * 3 + 1) * HEIGHT);
for (let y = 0; y < HEIGHT; y += 1) {
  const row = y * (WIDTH * 3 + 1);
  raw[row] = 0;
  for (let x = 0; x < WIDTH; x += 1) {
    const [r, g, b] = pixel(x, y);
    raw.set([r, g, b], row + 1 + x * 3);
  }
}

const header = Buffer.alloc(13);
header.writeUInt32BE(WIDTH, 0);
header.writeUInt32BE(HEIGHT, 4);
header[8] = 8; // bit depth
header[9] = 2; // RGB
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', header),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
writeFileSync(new URL('../cover.png', import.meta.url), png);
console.log(`cover.png: ${WIDTH}×${HEIGHT}, ${png.length} bytes`);
