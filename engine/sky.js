// The Cube sky: a three-stop vertical gradient that runs day → dusk → night →
// dawn, twinkling stars, horizon glows for sunset and sunrise, and a halo that
// breathes behind the cube at night. Cyclic (phase 0..1 wraps), so loops are seamless.
import { clamp, lerp, E, rng, h } from '/engine/lib.js';

const hex = c => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
const rgb = a => `rgb(${a.map(v => Math.round(v)).join(',')})`;

// [phase, [top, mid, bottom]] — the day stop is the site's hero gradient
export const DAY = ['#9d9ea8', '#a4a0a4', '#a7a09c'];
export const CYCLE = [
  [0.00, DAY],
  [0.20, DAY],
  [0.33, ['#5f6283', '#9b808d', '#d39c82']],   // dusk
  [0.45, ['#0a0e1e', '#131a33', '#252a46']],   // night
  [0.66, ['#0b1022', '#161d38', '#2b2e4c']],
  [0.78, ['#637499', '#988893', '#c3977f']],   // dawn (mirrors dusk, so white type holds the same contrast)
  [0.90, ['#8e9cb2', '#a59ea1', '#b7a291']],   // morning
  [1.00, DAY],
].map(([p, cs]) => [p, cs.map(hex)]);

const wrap = p => p - Math.floor(p);
const band = (p, a, b) => { p = wrap(p); return clamp((p - a) / (b - a)); };
export function skyAt(phase, keys = CYCLE) {
  const p = wrap(phase);
  for (let i = 1; i < keys.length; i++) if (p <= keys[i][0]) {
    const u = E.inOutSine((p - keys[i - 1][0]) / (keys[i][0] - keys[i - 1][0] || 1));
    return keys[i - 1][1].map((c, k) => c.map((v, j) => lerp(v, keys[i][1][k][j], u)));
  }
  return keys[keys.length - 1][1];
}
const ss = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
export const nightness = phase => { const p = wrap(phase); return ss(0.34, 0.45, p) * (1 - ss(0.68, 0.78, p)); };
export const duskGlow = phase => Math.sin(Math.PI * band(phase, 0.24, 0.46));
export const dawnGlow = phase => Math.sin(Math.PI * band(phase, 0.68, 0.94));

// Cube look for a phase: darker and bluer at night, warm at dawn and dusk.
export function cubeLook(phase) {
  const nt = nightness(phase), warm = Math.max(duskGlow(phase) * 0.6, dawnGlow(phase));
  return {
    exposure: 1 - 1.5 * nt + 0.15 * warm,
    grade: [lerp(1, 0.72, nt) * (1 + 0.07 * warm), lerp(1, 0.82, nt) * (1 + 0.01 * warm), lerp(1, 1.18, nt) * (1 - 0.06 * warm)],
    lift: [0, 0, 0.02 * nt],
  };
}

// Builds the sky layers into `parent` (behind the cube) and returns update(phase, cube).
export function buildSky(stage, { stars = 320, seed = 7 } = {}) {
  const { W, H, layers } = stage;
  const root = h('div', { class: 'layer' });
  const grad = h('div', { class: 'layer' });
  const gw = Math.max(W, H) * 1.5, gh = Math.max(W, H) * 0.85;
  const glowL = h('div', { class: 'abs', style: { left: `${-gw * 0.3}px`, top: `${H - gh * 0.55}px`, width: `${gw}px`, height: `${gh}px`, borderRadius: '50%', background: 'radial-gradient(closest-side, rgba(255,150,90,.55), rgba(255,150,90,0))' } });
  const glowR = h('div', { class: 'abs', style: { left: `${W - gw * 0.7}px`, top: `${H - gh * 0.5}px`, width: `${gw}px`, height: `${gh}px`, borderRadius: '50%', background: 'radial-gradient(closest-side, rgba(255,190,140,.45), rgba(255,190,140,0))' } });
  const canvas = h('canvas', { class: 'layer', width: W, height: H });
  root.append(grad, glowL, glowR, canvas);
  layers.bg.appendChild(root);
  const halo = h('div', { class: 'abs', style: { width: '900px', height: '900px', borderRadius: '50%', background: 'radial-gradient(closest-side, rgba(170,200,255,.55), rgba(140,170,255,.18) 45%, rgba(120,150,255,0))' } });
  layers.under.appendChild(halo);
  const r = rng(seed);
  const STAR = Array.from({ length: stars }, () => ({ x: r() * W, y: Math.pow(r(), 1.5) * H * 0.92, s: 0.5 + r() * 1.4, p: r() * 6.28, f: 1 + Math.floor(r() * 4) }));
  const ctx = canvas.getContext('2d');

  // phase: 0..1 around the clock; t: seconds (for twinkle); cube: {cx, cy, size}
  return function update(phase, t, cube) {
    const [c0, c1, c2] = skyAt(phase);
    grad.style.background = `linear-gradient(180deg, ${rgb(c0)} 0%, ${rgb(c1)} 55%, ${rgb(c2)} 100%)`;
    glowL.style.opacity = duskGlow(phase) * 0.9;
    glowR.style.opacity = dawnGlow(phase) * 0.95;
    const nt = nightness(phase);
    ctx.clearRect(0, 0, W, H);
    if (nt > 0.01) {
      for (const st of STAR) {
        const a = nt * (0.45 + 0.55 * (0.5 + 0.5 * Math.sin(phase * 2 * Math.PI * st.f * 6 + st.p)));
        ctx.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`;
        ctx.beginPath(); ctx.arc(st.x, st.y, st.s, 0, 6.283); ctx.fill();
      }
    }
    if (cube) {
      const beat = 0.5 + 0.5 * Math.cos(phase * 2 * Math.PI * 8);          // 8 breaths per cycle: loop-safe
      halo.style.transform = `translate(${cube.cx - 450}px, ${cube.cy - 450}px) scale(${(cube.size / 196) * (0.85 + 0.1 * beat * nt)})`;
      halo.style.opacity = nt * (0.55 + 0.3 * beat);
    }
    return nt;
  };
}
