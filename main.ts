// cutest-picture-01 entry: "Mochi Bunny" - a chubby cream bunny with a floppy ear, a flower and a little heart.
// Node 22, standard library only, no network, no randomness: the same bytes on every run.
// A small signed-distance-field rasteriser draws anti-aliased shapes; node:zlib writes the PNG.
//
//   MAKEFUN_OUTPUT_DIR=out node main.ts

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

const OUT = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const W = 1024;
const H = 1024;

type Col = [number, number, number];
type SD = (x: number, y: number) => number;
interface Layer {
  box: [number, number, number, number];
  sd: SD;
  fill: Col | ((x: number, y: number) => Col);
  alpha?: number;
  outline?: { w: number; col: Col };
  soft?: number;
}

const clamp = (v: number, a = 0, b = 1): number => (v < a ? a : v > b ? b : v);
const mix = (a: Col, b: Col, t: number): Col => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// ---------- distance shapes (pixels, negative inside) ----------
function ellipse(cx: number, cy: number, rx: number, ry: number, rot = 0): SD {
  const c = Math.cos(rot), s = Math.sin(rot);
  return (x, y) => {
    const dx = x - cx, dy = y - cy;
    const px = dx * c + dy * s, py = -dx * s + dy * c;
    const k0 = Math.hypot(px / rx, py / ry);
    const k1 = Math.hypot(px / (rx * rx), py / (ry * ry));
    return k1 < 1e-9 ? -Math.min(rx, ry) : (k0 * (k0 - 1)) / k1;
  };
}
const circle = (cx: number, cy: number, r: number): SD => (x, y) => Math.hypot(x - cx, y - cy) - r;
function capsule(ax: number, ay: number, bx: number, by: number, r: number): SD {
  return (x, y) => {
    const pax = x - ax, pay = y - ay, bax = bx - ax, bay = by - ay;
    const h = clamp((pax * bax + pay * bay) / (bax * bax + bay * bay));
    return Math.hypot(pax - bax * h, pay - bay * h) - r;
  };
}
/** Smooth union: blobs that melt into each other. */
const smoothUnion = (a: SD, b: SD, k: number): SD => (x, y) => {
  const d1 = a(x, y), d2 = b(x, y);
  const h = clamp(0.5 + (0.5 * (d2 - d1)) / k);
  return d2 + (d1 - d2) * h - k * h * (1 - h);
};
/** Heart (Inigo Quilez style distance estimate), centred on cx,cy, about 1.25*s tall. */
function heart(cx: number, cy: number, s: number): SD {
  const d2 = (x: number, y: number): number => x * x + y * y;
  return (x, y) => {
    const px = Math.abs(x - cx) / s, py = (cy + 0.62 * s - y) / s;
    let d: number;
    if (py + px > 1) d = Math.sqrt(d2(px - 0.25, py - 0.75)) - Math.SQRT2 / 4;
    else {
      const m = 0.5 * Math.max(px + py, 0);
      d = Math.sqrt(Math.min(d2(px, py - 1), d2(px - m, py - m))) * Math.sign(px - py);
    }
    return d * s;
  };
}
const arcSmile = (cx: number, cy: number, r: number, w: number): SD => (x, y) =>
  Math.max(Math.abs(Math.hypot(x - cx, y - cy) - r) - w / 2, cy - y);
const bx = (cx: number, cy: number, rx: number, ry: number, pad = 12): [number, number, number, number] => [cx - rx - pad, cy - ry - pad, cx + rx + pad, cy + ry + pad];

// ---------- palette ----------
const LINE: Col = [150, 98, 104]; // soft rose-brown outline
const CREAM: Col = [255, 247, 238];
const PINK: Col = [255, 168, 184];
const PINK_D: Col = [248, 128, 154];
const GOLD: Col = [255, 214, 96];

function lit(base: Col, cy: number, ry: number): (x: number, y: number) => Col {
  const hi = mix(base, [255, 255, 255], 0.55);
  const lo = mix(base, [232, 196, 208], 0.38);
  return (_x, y) => {
    const t = clamp((y - (cy - ry)) / (2 * ry));
    return t < 0.4 ? mix(hi, base, t / 0.4) : mix(base, lo, (t - 0.4) / 0.6);
  };
}

const layers: Layer[] = [];
const add = (l: Layer): void => { layers.push(l); };
const blob = (sd: SD, box: [number, number, number, number], base: Col, cy: number, ry: number, ow = 6): void =>
  add({ box, sd, fill: lit(base, cy, ry), outline: ow > 0 ? { w: ow, col: LINE } : undefined });
const oval = (cx: number, cy: number, rx: number, ry: number, base: Col, rot = 0, ow = 6): void =>
  blob(ellipse(cx, cy, rx, ry, rot), bx(cx, cy, Math.max(rx, ry), Math.max(rx, ry), ow + 8), base, cy, Math.max(rx, ry), ow);
const dot = (x: number, y: number, r: number, col: Col, a = 1, soft = 1.4): void =>
  add({ box: bx(x, y, r, r, 6), sd: circle(x, y, r), fill: col, alpha: a, soft });
const glow = (cx: number, cy: number, rx: number, ry: number, col: Col, a: number, soft: number): void =>
  add({ box: bx(cx, cy, rx, ry, soft + 8), sd: ellipse(cx, cy, rx, ry), fill: col, alpha: a, soft });

// ---------- background: peach to mint with soft bokeh ----------
add({
  box: [0, 0, W, H], sd: () => -1, fill: (x, y) => {
    const t = clamp(y / H);
    const base = mix([255, 226, 230], [226, 246, 238], clamp(t * 1.15));
    const r = Math.hypot(x - 512, y - 520) / 640;
    return mix(base, [255, 253, 248], clamp(0.7 - r * 0.8, 0, 0.6));
  },
});
const bokeh: Array<[number, number, number, Col, number]> = [
  [110, 140, 90, [255, 205, 220], 0.55], [905, 110, 66, [255, 240, 180], 0.65], [60, 560, 56, [200, 232, 255], 0.55],
  [960, 500, 80, [255, 210, 228], 0.5], [140, 900, 76, [255, 240, 185], 0.55], [910, 890, 96, [200, 238, 222], 0.55],
  [790, 55, 36, [215, 235, 255], 0.6], [330, 50, 34, [255, 218, 232], 0.6], [200, 330, 30, [255, 255, 255], 0.5], [830, 360, 26, [255, 255, 255], 0.5],
];
for (const [x, y, r, c, a] of bokeh) dot(x, y, r, c, a, 3);
// ground + shadow
glow(512, 925, 360, 54, [255, 214, 204], 0.7, 14);
glow(512, 915, 270, 30, [205, 150, 165], 0.5, 22);

// ---------- bunny ----------
// floppy right ear (behind head), upright left ear
oval(748, 330, 74, 175, CREAM, -0.62, 6);
oval(742, 345, 40, 130, PINK, -0.62, 0);
oval(330, 215, 84, 205, CREAM, 0.12, 6);
oval(334, 225, 44, 150, PINK, 0.12, 0);
glow(334, 160, 30, 70, [255, 205, 215], 0.7, 18);

// round fluffy tail peeking out, then body, feet
oval(782, 842, 52, 52, CREAM, 0, 6);
glow(770, 826, 20, 16, [255, 255, 255], 0.9, 8);
oval(512, 790, 215, 165, CREAM, 0, 6);
glow(512, 830, 140, 100, [255, 255, 255], 0.9, 30);
oval(372, 912, 92, 48, CREAM, 0, 6);
oval(652, 912, 92, 48, CREAM, 0, 6);
for (const x of [372, 652]) {
  add({ box: bx(x, 916, 36, 26, 6), sd: ellipse(x, 920, 30, 22), fill: PINK, alpha: 0.9, soft: 1.4 });
  for (const dx of [-24, 0, 24]) dot(x + dx, 890, 9, PINK_D, 0.9);
}

// forehead tuft peeking over the top of the head (drawn behind it)
for (const [x, y, rot] of [[452, 232, -0.6], [512, 205, 0], [572, 232, 0.6]] as Array<[number, number, number]>) {
  add({ box: bx(x, y, 60, 70, 12), sd: ellipse(x, y, 24, 52, rot), fill: lit(CREAM, y, 52), outline: { w: 6, col: LINE } });
}
// head: wide, chubby, slightly squashed
const headCy = 470;
blob(ellipse(512, headCy, 300, 250), bx(512, headCy, 310, 260, 14), CREAM, headCy, 250, 6);

// cheeks (fluffy), blush
glow(300, 560, 70, 44, PINK, 0.6, 20);
glow(724, 560, 70, 44, PINK, 0.6, 20);

// eyes: big, glossy, set low and wide for baby proportions
for (const ex of [372, 652]) {
  const ey = 500;
  add({ box: bx(ex, ey, 70, 84, 8), sd: ellipse(ex, ey, 58, 74), fill: (x, y) => mix([40, 26, 44], [96, 62, 96], clamp((y - (ey - 20)) / 90)) });
  add({ box: bx(ex, ey + 30, 50, 50, 14), sd: ellipse(ex, ey + 34, 38, 34), fill: [140, 105, 170], alpha: 0.55, soft: 16 });
  dot(ex - 18, ey - 28, 23, [255, 255, 255], 1, 1.4);
  dot(ex + 22, ey + 22, 11, [255, 255, 255], 0.95);
  dot(ex + 24, ey - 22, 6, [255, 255, 255], 0.85);
  dot(ex - 24, ey + 38, 5, [255, 255, 255], 0.7);
}
// nose, mouth
add({ box: bx(512, 548, 26, 22, 8), sd: ellipse(512, 548, 22, 16), fill: PINK_D, outline: { w: 4, col: LINE } });
dot(504, 543, 5, [255, 220, 228], 0.9);
// three tiny blush strokes on each cheek
for (const [x, y] of [[270, 570], [292, 578], [314, 570], [710, 570], [732, 578], [754, 570]] as Array<[number, number]>) {
  add({ box: bx(x, y, 8, 14, 4), sd: capsule(x - 4, y + 7, x + 4, y - 7, 2.2), fill: PINK_D, alpha: 0.6, soft: 1.3 });
}
add({ box: bx(512, 570, 6, 16, 6), sd: capsule(512, 562, 512, 578, 2.6), fill: LINE });
add({ box: bx(488, 584, 30, 24, 6), sd: arcSmile(488, 574, 22, 5.5), fill: LINE, soft: 1.3 });
add({ box: bx(536, 584, 30, 24, 6), sd: arcSmile(536, 574, 22, 5.5), fill: LINE, soft: 1.3 });
// tiny tongue
add({ box: bx(512, 604, 18, 14, 6), sd: ellipse(512, 596, 13, 10), fill: [255, 140, 160], alpha: 0.9, soft: 1.4 });

// whiskers (very light)
for (const [x1, y1, x2, y2] of [[262, 560, 170, 540], [260, 584, 166, 592]] as Array<[number, number, number, number]>) {
  add({ box: [150, 520, 280, 620], sd: capsule(x1, y1, x2, y2, 2.4), fill: LINE, alpha: 0.38, soft: 1.3 });
  add({ box: [744, 520, 874, 620], sd: capsule(W - x1, y1, W - x2, y2, 2.4), fill: LINE, alpha: 0.38, soft: 1.3 });
}

// flower on the head, near the floppy ear
const fx = 676, fy = 268;
for (let i = 0; i < 5; i++) {
  const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
  const px = fx + Math.cos(a) * 30, py = fy + Math.sin(a) * 30;
  add({ box: bx(px, py, 28, 28, 12), sd: circle(px, py, 24), fill: lit([255, 190, 205], py, 24), outline: { w: 4.5, col: LINE } });
}
add({ box: bx(fx, fy, 26, 26, 8), sd: circle(fx, fy, 19), fill: lit(GOLD, fy, 19), outline: { w: 4.5, col: LINE } });
dot(fx - 6, fy - 7, 5, [255, 255, 255], 0.85);

// arms hugging a little heart
const hx = 512, hy = 800;
add({ box: bx(hx, hy, 90, 90, 14), sd: heart(hx, hy, 66), fill: lit([255, 120, 150], hy, 70), outline: { w: 6, col: LINE } });
dot(hx - 26, hy - 14, 10, [255, 255, 255], 0.8);
oval(402, 790, 70, 46, CREAM, -0.5, 6);
oval(622, 790, 70, 46, CREAM, 0.5, 6);
for (const [x, y] of [[434, 760], [452, 775], [592, 775], [610, 760]] as Array<[number, number]>) {
  add({ box: bx(x, y, 8, 12, 4), sd: capsule(x - 3, y - 4, x + 3, y + 5, 2), fill: LINE, alpha: 0.55, soft: 1.2 });
}

// small hearts and sparkles
for (const [x, y, s, c] of [[170, 230, 22, [255, 140, 170]], [860, 205, 28, [255, 130, 160]], [930, 330, 15, [255, 170, 190]], [100, 400, 14, [255, 150, 175]]] as Array<[number, number, number, Col]>) {
  add({ box: bx(x, y, s * 1.4, s * 1.4, 10), sd: heart(x, y, s), fill: c, outline: { w: 4.5, col: LINE } });
}
for (const [x, y, s] of [[225, 105, 22], [600, 70, 16], [120, 680, 20], [905, 680, 24], [930, 810, 14], [240, 990, 12], [820, 120, 16]] as Array<[number, number, number]>) {
  const a = ellipse(x, y, s, s * 0.2), b = ellipse(x, y, s * 0.2, s);
  add({ box: bx(x, y, s, s, 6), sd: (px, py) => smoothUnion(a, b, 4)(px, py), fill: [255, 252, 220], outline: { w: 3, col: [246, 205, 120] } });
}

// ---------- rasterise ----------
const buf = new Float32Array(W * H * 3);
const blend = (i: number, c: Col, a: number): void => {
  if (a <= 0) return;
  buf[i] = buf[i]! + (c[0] - buf[i]!) * a;
  buf[i + 1] = buf[i + 1]! + (c[1] - buf[i + 1]!) * a;
  buf[i + 2] = buf[i + 2]! + (c[2] - buf[i + 2]!) * a;
};
for (const l of layers) {
  const x0 = Math.max(0, Math.floor(l.box[0])), y0 = Math.max(0, Math.floor(l.box[1]));
  const x1 = Math.min(W - 1, Math.ceil(l.box[2])), y1 = Math.min(H - 1, Math.ceil(l.box[3]));
  const soft = l.soft ?? 1.2;
  const ow = l.outline?.w ?? 0;
  const al = l.alpha ?? 1;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const px = x + 0.5, py = y + 0.5;
      const d = l.sd(px, py);
      if (d > ow + soft + 1) continue;
      const i = (y * W + x) * 3;
      if (l.outline) blend(i, l.outline.col, clamp(0.5 - (d - ow) / soft) * al);
      const f = typeof l.fill === 'function' ? l.fill(px, py) : l.fill;
      blend(i, f, clamp(0.5 - d / soft) * al);
    }
  }
}

// ---------- PNG ----------
const stride = W * 3 + 1;
const raw = Buffer.alloc(stride * H);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W * 3; x++) raw[y * stride + 1 + x] = Math.max(0, Math.min(255, Math.round(buf[y * W * 3 + x]!)));
}
const crcTable = new Int32Array(256);
for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c; }
function crc32(b: Buffer): number { let c = -1; for (const v of b) c = crcTable[(c ^ v) & 255]! ^ (c >>> 8); return (c ^ -1) >>> 0; }
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
]);
if (png.length > 1048576) throw new Error(`png is ${png.length} bytes, over 1 MiB`);
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'entry.png'), png);
