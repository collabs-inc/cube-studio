// Timing, easing and DOM helpers for the reel. Everything is a pure function
// of time so any frame can be rendered in any order.

export const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const inv = (a, b, x) => clamp((x - a) / (b - a));
export const mix = lerp;
export const smooth = (a, b, x) => { const t = inv(a, b, x); return t * t * (3 - 2 * t); };

// Cubic-bezier solver (same curve definition as CSS).
export function bezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = t => ((ax * t + bx) * t + cx) * t;
  const sy = t => ((ay * t + by) * t + cy) * t;
  const dx = t => (3 * ax * t + 2 * bx) * t + cx;
  return x => {
    if (x <= 0) return 0; if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) { const e = sx(t) - x; const d = dx(t); if (Math.abs(e) < 1e-6) break; if (Math.abs(d) < 1e-6) break; t -= e / d; }
    let lo = 0, hi = 1;
    if (Math.abs(sx(t) - x) > 1e-5) { t = x; for (let i = 0; i < 30; i++) { const v = sx(t); if (v < x) lo = t; else hi = t; t = (lo + hi) / 2; } }
    return sy(t);
  };
}

export const E = {
  linear: t => t,
  inQuad: t => t * t, outQuad: t => 1 - (1 - t) * (1 - t),
  inOutQuad: t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  inCubic: t => t * t * t, outCubic: t => 1 - Math.pow(1 - t, 3),
  inOutCubic: t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  inQuart: t => t * t * t * t, outQuart: t => 1 - Math.pow(1 - t, 4),
  inOutQuart: t => (t < 0.5 ? 8 * t ** 4 : 1 - Math.pow(-2 * t + 2, 4) / 2),
  inQuint: t => t ** 5, outQuint: t => 1 - Math.pow(1 - t, 5),
  inOutQuint: t => (t < 0.5 ? 16 * t ** 5 : 1 - Math.pow(-2 * t + 2, 5) / 2),
  inExpo: t => (t === 0 ? 0 : Math.pow(2, 10 * t - 10)),
  outExpo: t => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  inOutExpo: t => (t === 0 ? 0 : t === 1 ? 1 : t < 0.5 ? Math.pow(2, 20 * t - 10) / 2 : (2 - Math.pow(2, -20 * t + 10)) / 2),
  inSine: t => 1 - Math.cos((t * Math.PI) / 2), outSine: t => Math.sin((t * Math.PI) / 2),
  inOutSine: t => -(Math.cos(Math.PI * t) - 1) / 2,
  outBack: (t, s = 1.70158) => 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2),
  inBack: (t, s = 1.70158) => (s + 1) * t * t * t - s * t * t,
  // The house curve: fast out of the gate, long settle. Reads as "confident".
  snap: bezier(0.16, 1, 0.3, 1),
  glide: bezier(0.65, 0, 0.35, 1),
  swift: bezier(0.2, 0.8, 0.2, 1),
  push: bezier(0.7, 0, 0.84, 0),
};
export const backOut = s => t => E.outBack(t, s);

// Damped spring step response, 0 → 1 (t in seconds from the kick).
export function spring(t, w = 14, z = 0.45) {
  if (t <= 0) return 0;
  if (z >= 1) { return 1 - (1 + w * t) * Math.exp(-w * t); }
  const wd = w * Math.sqrt(1 - z * z);
  return 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + (z * w / wd) * Math.sin(wd * t));
}

// Tween helper: eased progress of [t0, t0+dur].
export const tw = (t, t0, dur, ease = E.outCubic) => ease(inv(t0, t0 + dur, t));

// Piecewise keyframes: [[time, value, easeIntoThisKey?], ...]
export function keys(t, list) {
  if (t <= list[0][0]) return list[0][1];
  for (let i = 1; i < list.length; i++) {
    const [t1, v1, ease = E.inOutCubic] = list[i];
    const [t0, v0] = list[i - 1];
    if (t <= t1) {
      const p = ease(inv(t0, t1, t));
      return Array.isArray(v0) ? v0.map((v, k) => lerp(v, v1[k], p)) : lerp(v0, v1, p);
    }
  }
  return list[list.length - 1][1];
}

// Deterministic noise for shakes and flicker.
export function hash(n) { n = Math.sin(n * 127.1 + 311.7) * 43758.5453; return n - Math.floor(n); }
export function noise1(x) { const i = Math.floor(x), f = x - i; const u = f * f * (3 - 2 * f); return lerp(hash(i), hash(i + 1), u) * 2 - 1; }

// ---- DOM --------------------------------------------------------------------
const SVGNS = 'http://www.w3.org/2000/svg';
const SVG_TAGS = new Set(['svg', 'g', 'path', 'line', 'circle', 'rect', 'polyline', 'polygon', 'text', 'tspan', 'defs', 'clipPath', 'mask', 'linearGradient', 'radialGradient', 'stop', 'filter', 'feGaussianBlur', 'feColorMatrix', 'ellipse', 'use', 'pattern']);
export function h(tag, attrs = {}, ...kids) {
  const svg = SVG_TAGS.has(tag);
  const n = svg ? document.createElementNS(SVGNS, tag) : document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null) continue;
    if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
    else if (k === 'class') n.setAttribute('class', v);
    else if (k === 'text') n.textContent = v;
    else if (k === 'html') n.innerHTML = v;
    else n.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  return n;
}

const fmt = v => (Math.abs(v) < 1e-4 ? 0 : +v.toFixed(3));
// Apply a transform/opacity/blur state in one go.
export function put(n, o = {}) {
  const parts = [];
  if (o.x || o.y) parts.push(`translate(${fmt(o.x || 0)}px,${fmt(o.y || 0)}px)`);
  if (o.z) parts.push(`translateZ(${fmt(o.z)}px)`);
  if (o.rx) parts.push(`rotateX(${fmt(o.rx)}deg)`);
  if (o.ry) parts.push(`rotateY(${fmt(o.ry)}deg)`);
  if (o.r) parts.push(`rotate(${fmt(o.r)}deg)`);
  if (o.skx) parts.push(`skewX(${fmt(o.skx)}deg)`);
  if (o.s != null && o.s !== 1) parts.push(`scale(${fmt(o.s)})`);
  if (o.sx != null || o.sy != null) parts.push(`scale(${fmt(o.sx ?? 1)},${fmt(o.sy ?? 1)})`);
  n.style.transform = parts.join(' ') || 'none';
  if (o.o != null) n.style.opacity = fmt(clamp(o.o));
  if ('blur' in o || 'mb' in o || 'bright' in o) {
    const f = [];
    if (o.mb) f.push(o.mb);
    if (o.blur > 0.05) f.push(`blur(${fmt(o.blur)}px)`);
    if (o.bright != null) f.push(`brightness(${fmt(o.bright)})`);
    n.style.filter = f.length ? f.join(' ') : 'none';
  }
}
export const show = (n, on) => { n.style.display = on ? '' : 'none'; };

// Directional (motion) blur via per-element SVG filters.
let mbCount = 0;
const mbMap = new WeakMap();
export function motionBlur(n, dx, dy) {
  let f = mbMap.get(n);
  if (!f) {
    const id = `mb${mbCount++}`;
    const blur = h('feGaussianBlur', { in: 'SourceGraphic', stdDeviation: '0 0' });
    const filt = h('filter', { id, x: '-50%', y: '-50%', width: '200%', height: '200%', 'color-interpolation-filters': 'sRGB' }, blur);
    document.getElementById('filters').appendChild(filt);
    f = { id, blur }; mbMap.set(n, f);
  }
  const sx = Math.abs(dx), sy = Math.abs(dy);
  if (sx < 0.35 && sy < 0.35) return '';
  f.blur.setAttribute('stdDeviation', `${fmt(sx)} ${fmt(sy)}`);
  return `url(#${f.id})`;
}

// Resample a closed polyline to n points by arc length.
export function resample(pts, n) {
  const segs = [], cum = [0];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    segs.push(l); cum.push(cum[i] + l);
  }
  const total = cum[pts.length], out = [];
  let k = 0;
  for (let j = 0; j < n; j++) {
    const d = (j / n) * total;
    while (k < pts.length - 1 && cum[k + 1] < d) k++;
    const a = pts[k], b = pts[(k + 1) % pts.length];
    const f = segs[k] ? (d - cum[k]) / segs[k] : 0;
    out.push([lerp(a[0], b[0], f), lerp(a[1], b[1], f)]);
  }
  return out;
}
export function polyLen(pts, closed = true) {
  let L = 0;
  for (let i = 0; i < pts.length - (closed ? 0 : 1); i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; L += Math.hypot(b[0] - a[0], b[1] - a[1]); }
  return L;
}
// Point at arc fraction p along a polyline.
export function pointAt(pts, p, closed = true) {
  const n = pts.length, m = closed ? n : n - 1;
  const L = polyLen(pts, closed) * clamp(p);
  let acc = 0;
  for (let i = 0; i < m; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (acc + l >= L) { const f = l ? (L - acc) / l : 0; return [lerp(a[0], b[0], f), lerp(a[1], b[1], f)]; }
    acc += l;
  }
  return closed ? pts[0] : pts[n - 1];
}
export const toPath = (pts, closed = true) => 'M' + pts.map(p => `${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join('L') + (closed ? 'Z' : '');

// Seeded RNG
export function rng(seed = 1) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
