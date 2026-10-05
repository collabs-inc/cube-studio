// The house end card, from the brand reel (videos/2026-09-cube-showreel, `H_`): the 3D cube lands in the
// lockup and flattens into the white mark, the combomark wipes out from behind it, the line arrives word
// by word, and cube.computer arrives as the site's light pill button with a glint.
//
//   const end = endCard(stage, { at: T.impact, beat: BEAT, line: 'A new home for your agents.' });
//   stage.cube(t => (t < T.impact ? myCube(t) : end.cube(t)));     // the reel's impact; or land your own on end.lock
//   stage.onFrame(end.update);
//
// Timings (seconds after `at`): land +0.36, flat +0.42, word +0.56, line +beat+0.14, url +beat+0.36,
// glint url+0.42. A custom landing must sit at end.lock (mx, my, size; iso pose, fillet 0) by `flat`.
// Times, layout, line, url and sky can all be overridden through opts.
import { lerp, inv, E, tw, spring, h, put, show } from '/engine/lib.js';
import { markSVG, MARK_HALF, ISO_EL } from '/engine/mark.js';

// Per-format lockup: k = combomark scale, cy = mark centre, line/cta tops, type sizes.
const LAYOUT = {
  '16x9': { k: 0.382, cy: 392, line: 566, cta: 690, lineFs: 54, ctaFs: 58 },
  '9x16': { k: 0.36, cy: 820, line: 1010, cta: 1142, lineFs: 60, ctaFs: 62 },
  '1x1': { k: 0.3, cy: 392, line: 540, cta: 650, lineFs: 48, ctaFs: 52 },
  '4x5': { k: 0.32, cy: 500, line: 668, cta: 786, lineFs: 52, ctaFs: 56 },
};
// combomark-white.png is 2800 × 1000; the mark's centre sits at (576, 506), 445.9 px per mark unit, and
// the wordmark starts at x = 870.
const CM = { w: 2800, h: 1000, mx: 576, my: 506, unit: 445.9, wordX: 870, centre: 295 + 2146 / 2 };
export const SKY = 'linear-gradient(180deg, #9d9ea8 0%, #a4a0a4 50%, #a7a09c 100%)';

export function endCard(stage, opts = {}) {
  const { W, CX, fmt } = stage;
  const at = opts.at, beat = opts.beat ?? 0.5;
  const T = {
    land: at + 0.36, flat: at + 0.42, word: at + 0.56,
    line: at + beat + 0.14, url: at + beat + 0.36, ...opts.times,
  };
  T.glint = T.url + 0.42;
  const Lo = { ...LAYOUT[fmt] || LAYOUT['16x9'], ...opts.layout };
  const lock = { k: Lo.k, cy: Lo.cy, left: CX - CM.centre * Lo.k, top: Lo.cy - CM.my * Lo.k };
  lock.mx = lock.left + CM.mx * Lo.k; lock.my = lock.top + CM.my * Lo.k; lock.size = CM.unit * Lo.k;

  const root = h('div', { class: 'layer' });
  if (opts.background !== false) {
    root.append(
      h('div', { class: 'layer', style: { background: opts.sky || SKY } }),
      h('div', { class: 'abs glow', style: { left: `${CX - 800}px`, top: `${Lo.cy - 600}px`, width: '1600px', height: '1200px', borderRadius: '50%', background: 'radial-gradient(closest-side, rgba(255,250,246,.30), rgba(255,250,246,0))' } }));
    stage.layers.bg.appendChild(root);
  }
  const glow = root.querySelector('.glow');

  const over = h('div', { class: 'layer' });
  const flat = markSVG('#ffffff', { width: 2 * MARK_HALF * lock.size, height: 2 * MARK_HALF * lock.size, class: 'abs' });
  flat.style.left = `${lock.mx - MARK_HALF * lock.size}px`; flat.style.top = `${lock.my - MARK_HALF * lock.size}px`;
  const word = h('div', { class: 'abs', style: { left: `${lock.left}px`, top: `${lock.top}px`, width: `${CM.w * Lo.k}px`, height: `${CM.h * Lo.k}px`, backgroundImage: 'url(/brand/img/combomark-white.png)', backgroundSize: '100% 100%' } });
  const line = h('div', { class: 'abs hero', style: { left: 0, width: `${W}px`, top: `${Lo.line}px`, textAlign: 'center', color: '#fff', fontSize: `${Lo.lineFs}px`, fontWeight: 500, letterSpacing: '-0.01em' } });
  const words = (opts.line ?? 'A new home for your agents.').split(' ').map(w => h('span', { class: 'line-mask' }, h('span', { text: w })));
  words.forEach((m, i) => { line.appendChild(m); if (i < words.length - 1) line.appendChild(document.createTextNode(' ')); });
  const glint = h('i', { style: { position: 'absolute', top: '-20%', bottom: '-20%', left: 0, width: '38%', display: 'block', background: 'linear-gradient(100deg, rgba(255,255,255,0) 0%, rgba(255,255,255,.95) 50%, rgba(255,255,255,0) 100%)', mixBlendMode: 'soft-light' } });
  const pill = h('div', { class: 'hero', style: { position: 'relative', overflow: 'hidden', background: '#f4f1ed', color: '#23201d', fontSize: `${Lo.ctaFs}px`, fontWeight: 500, letterSpacing: '-0.015em', lineHeight: '1', padding: '26px 56px 30px', borderRadius: '999px', boxShadow: '0 22px 50px -20px rgba(35,32,29,.55), inset 0 1px 0 rgba(255,255,255,.8)', transformOrigin: '50% 50%' } },
    h('span', { text: opts.url ?? 'cube.computer' }), glint);
  const cta = h('div', { class: 'abs', style: { left: 0, width: `${W}px`, top: `${Lo.cta}px`, display: 'flex', justifyContent: 'center' } }, pill);
  over.append(flat, word, line, cta);
  stage.layers.over.appendChild(over);

  function update(t) {
    const on = t >= at;
    show(root, on); show(over, on);
    if (!on) return;
    over.style.transformOrigin = `${CX}px ${Lo.cy}px`;
    put(over, { s: 1 + 0.018 * E.inOutSine(inv(at, stage.duration, t)) });      // the camera keeps drifting
    if (glow) glow.style.opacity = 0.42 + 0.4 * Math.exp(-(t - at) * 3);
    flat.style.opacity = tw(t, T.flat + 0.1, 0.1, E.linear);                     // the flat mark takes over from the cube
    const wu = tw(t, T.word, 0.62, E.snap);                                       // wordmark wipes out from behind the mark
    const m = (CM.wordX / CM.w) * 100, r = m + (100 - m) * wu;
    word.style.clipPath = `polygon(${m}% 0, ${r}% 0, ${r}% 100%, ${m}% 100%)`;
    put(word, { x: (1 - wu) * -40, o: tw(t, T.word, 0.1) });
    words.forEach((n, i) => { const u = tw(t, T.line + i * 0.045, 0.7, E.snap); put(n.firstChild, { y: (1 - u) * 70 }); });
    const cu = spring(t - T.url, 16, 0.55);
    put(pill, { s: t < T.url ? 0.001 : 0.82 + 0.18 * cu, o: tw(t, T.url, 0.12), y: (1 - Math.min(1, cu)) * 24 });
    const gl = tw(t, T.glint, 0.55, E.inOutCubic);
    glint.style.transform = `translateX(${lerp(-110, 300, gl)}%)`;
    glint.style.opacity = gl > 0 && gl < 1 ? 1 : 0;
  }

  // The cube's pose for the impact, as in the reel: it punches in from the centre at 2.25× and springs
  // down into the lockup, spinning to the iso pose that matches the flat mark, then fades out under it.
  function cube(t) {
    if (t < at || t >= T.flat + 0.22) return null;
    const d = t - at, k = spring(d, 15, 0.62), p = spring(d - 0.03, 13, 0.75);
    const m = tw(t, at + 0.2, 0.3, E.inOutCubic);
    return {
      cx: lerp(CX, lock.mx, p), cy: lerp(stage.CY + 20, lock.my, p), size: lock.size * (1 + 1.25 * (1 - k)),
      spin: lerp(Math.PI * 0.35, Math.PI * 2, tw(t, at, 0.5, E.outCubic)),
      elevation: lerp(-14, ISO_EL, m), fillet: lerp(0.57, 0, m), height: lerp(0.93, 1, m),
      look: { exposure: 1 + 0.9 * Math.exp(-d / 0.08) + 0.3 * m, opacity: 1 - tw(t, T.flat + 0.1, 0.1, E.linear) },
    };
  }

  return { update, cube, lock, T };
}
