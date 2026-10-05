// A stage for a composition: picks the format from ?fmt=, sets up the layer
// stack (bg · under · WebGL · over · fx), loads the brand fonts and wires the
// render contract that engine/render.mjs and the studio drive:
//   window.renderFrame(t) · window.reelInfo = { DURATION, FPS } · window.reelReady
import { Prism } from '/engine/prism.js';

export const FORMATS = { '16x9': [1920, 1080], '9x16': [1080, 1920], '1x1': [1080, 1080], '4x5': [1080, 1350] };

// The app ships open fonts only (Geist, OFL). The hero face falls back to Geist; a project that licenses
// its own display face overrides this file, or the fonts, in its own engine/ or brand/ (see paths.mjs).
const FONTS = [
  ['Geist', 'Geist-Regular', 400], ['Geist', 'Geist-Medium', 500], ['Geist', 'Geist-SemiBold', 600],
  ['Geist Mono', 'GeistMono-Regular', 400], ['Geist Mono', 'GeistMono-Medium', 500], ['Geist Mono', 'GeistMono-SemiBold', 600],
];

export function createStage({ duration, fps = 60, background = 'linear-gradient(180deg, #9d9ea8 0%, #a4a0a4 50%, #a7a09c 100%)' }) {
  const qs = new URLSearchParams(location.search);
  const fmt = FORMATS[qs.get('fmt')] ? qs.get('fmt') : '16x9';
  const [W, H] = FORMATS[fmt];
  const pr = parseFloat(qs.get('pr') || '1');
  const mbMax = parseInt(qs.get('mb') || '8', 10);
  const variant = qs.get('variant') || '';

  const css = `
${FONTS.map(([fam, file, w]) => `@font-face { font-family: "${fam}"; src: url("/brand/fonts/${file}.woff2") format("woff2"); font-weight: ${w}; }`).join('\n')}
:root { --paper: #f3f4f6; --ink: #15171a; --signal: #e0351f; --sky: linear-gradient(180deg, #9d9ea8 0%, #a4a0a4 50%, #a7a09c 100%);
  --hero: "PP Neue Montreal", "Geist", system-ui, sans-serif; --ui: "Geist", system-ui, sans-serif; --mono: "Geist Mono", ui-monospace, monospace; }
html, body { margin: 0; background: #000; }
body { width: ${W}px; height: ${H}px; overflow: hidden; -webkit-font-smoothing: antialiased; text-rendering: geometricPrecision; }
#stage, #world, .layer { position: absolute; left: 0; top: 0; width: ${W}px; height: ${H}px; }
#stage { overflow: hidden; background: ${background}; }
#gl { position: absolute; left: 0; top: 0; width: ${W}px; height: ${H}px; pointer-events: none; }
.abs { position: absolute; left: 0; top: 0; }
.hero { font-family: var(--hero); } .ui { font-family: var(--ui); } .mono { font-family: var(--mono); }
.line-mask { display: inline-block; overflow: hidden; vertical-align: top; padding: 0 .04em .12em; margin: 0 -.04em -.12em; }
.line-mask > span { display: inline-block; }`;
  document.head.appendChild(Object.assign(document.createElement('style'), { textContent: css }));

  const el = (id, tag = 'div', cls = 'layer') => Object.assign(document.createElement(tag), { id, className: cls });
  const stage = el('stage', 'div', ''), world = el('world', 'div', '');
  const bg = el('bg'), under = el('under'), over = el('over'), fx = el('fx');
  const canvas = el('gl', 'canvas', '');
  world.append(bg, under, canvas, over);
  stage.append(world, fx);
  document.body.appendChild(stage);
  if (!document.getElementById('filters')) {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('width', 0); s.setAttribute('height', 0); s.style.position = 'absolute';
    s.innerHTML = '<defs id="filters"></defs>';
    document.body.appendChild(s);
  }

  let prism = null;
  const updates = [];
  let cubeFn = null;
  const api = {
    W, H, CX: W / 2, CY: H / 2, fmt, pr, variant, duration, fps, qs,
    layers: { stage, world, bg, under, over, fx, canvas },
    L: (map, fallback) => (fmt in map ? map[fmt] : fallback),       // per-format value
    get prism() { if (!prism) prism = new Prism(canvas, W, H, pr); return prism; },
    onFrame(fn) { updates.push(fn); return api; },
    // fn(t) → cube pose { cx, cy, size, spin, ..., look } or null; motion blur picked from speed
    cube(fn) { cubeFn = fn; api.prism; return api; },
    async start() {
      await Promise.all(FONTS.map(([fam, , w]) => document.fonts.load(`${w} 20px "${fam}"`)));
      await document.fonts.ready;
      await Promise.all([...document.images].map(i => i.decode().catch(() => {})));
      window.reelInfo = { DURATION: duration, FPS: fps, W, H, fmt };
      window.renderFrame = t => {
        for (const fn of updates) fn(t);
        if (!cubeFn) return 0;
        const P = cubeFn(t);
        if (!P) { api.prism.clear(); return 0; }
        const dt = 0.5 / fps, a = cubeFn(t - dt / 2), c = cubeFn(t + dt / 2);
        let n = 1;
        if (a && c) {
          const d = Math.hypot(c.cx - a.cx, c.cy - a.cy) + Math.abs(c.size - a.size) * 0.8 + Math.abs(c.spin - a.spin) * P.size * 0.65;
          n = Math.max(1, Math.min(mbMax, Math.ceil(d / 2.5)));
        }
        const poses = n === 1 ? [P] : Array.from({ length: n }, (_, i) => cubeFn(t + dt * (i / (n - 1) - 0.5))).filter(Boolean);
        api.prism.render(poses, { ...P.look, seed: t * 7.13 });
        return poses.length;
      };
      window.renderFrame(0);
      window.reelReady = true;
    },
  };
  return api;
}
