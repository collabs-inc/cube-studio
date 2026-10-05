// The feature series' plate and end card (director/directions/feature-series.md), shared so every episode opens
// and closes identically. Bar 1, in the brand reel's language: frame one is the finished black-and-white Cube mark
// alone on the reel's Swiss paper. The HUD draws in (an ink hairline, "CUBE COMPUTER — FEATURES", the series'
// twelve segments); on beat 2 the mark docks into the HUD's corner beside the counter ("08 / 12") as the episode's
// number rises in signal red; on beat 3 its title sets word by word (with the episode's glyph, if it has one) and
// its segment fills red through the rest of the bar. The finale reads "Docs" where an episode reads its number, has
// no counter, and its red runs through all twelve segments. The episode cuts in on the downbeat of bar 2.
//
//   import { seriesPlate, seriesEnd } from '/engine/series.js';
//   const plate = seriesPlate(stage, { beat: BEAT, number: 8, title: 'Localhost previews' });   // plate.end = b(4)
//   const end = seriesEnd(stage, { at: T.impact, beat: BEAT, docs: 'docs.cube.computer/docs/localhost' });
//   stage.cube(end.cube).onFrame(plate.update).onFrame(end.update);
//
// Options: `title` is a string ('\n' forces a break) or { '16x9': …, default: … } per format. `glyph` is an element
// shown in one fixed slot (seriesLayout(stage).glyph: right of the number, flush with the right margin, as tall as
// the number's figures, at least 0.3 em clear of the widest number, "08"), rising with the title; a glyph bigger
// than the slot is scaled down to fit. `markTo: { x, y, size }` lands the mark there (screen px, px per mark unit) instead of
// docking it into the HUD. The music for both ends is engine/series-audio.mjs (plateSting, endBlock), on the same
// cues (seriesCues). The plate's HUD and mark don't move with its slow push, so an episode can hold them across the
// cut at seriesLayout(stage)'s positions.
import { E, tw, inv, clamp, lerp, bezier, h, show, put, motionBlur } from '/engine/lib.js';
import { markSVG, MARK_HALF, MARK } from '/engine/mark.js';
import { endCard } from '/engine/endcard.js';
import { seriesCues, titleWords, EPISODES } from '/engine/series-cues.js';

export { seriesCues, titleWords, EPISODES };
export const INK = '#15171a', SOFT = '#5c6068', SIGNAL = '#e0351f', PAPER = '#f3f4f6';

// Per format: the HUD's margin M and top, its counter and label sizes, the rule's y, the segments' y and height,
// the frame-one mark (px per mark unit), and the display type: the number and the title as [x, top, size].
const PLATE = {
  '16x9': { M: 160, top: 70, rule: 132, seg: 968, segH: 4, hud: 26, lab: 19, mark: 280, number: [146, 262, 300], title: [164, 640, 66], glyphX: 1160 },
  '9x16': { M: 80, top: 118, rule: 196, seg: 1770, segH: 6, hud: 36, lab: 24, mark: 340, number: [58, 690, 380], title: [80, 1180, 84], glyphX: 640 },
  '1x1': { M: 80, top: 64, rule: 118, seg: 984, segH: 5, hud: 28, lab: 20, mark: 260, number: [62, 250, 290], title: [80, 610, 62], glyphX: 560 },
  '4x5': { M: 80, top: 76, rule: 138, seg: 1236, segH: 5, hud: 30, lab: 21, mark: 300, number: [62, 340, 310], title: [80, 740, 70], glyphX: 560 },
};
const SEG_GAP = 8, PUSH = 0.018;
// PP Neue Montreal Medium: ascent 0.957 em, figure height 0.737 em; the number sets at line-height 1.14
const FIG_TOP = (1.14 - 1.2) / 2 + 0.957 - 0.737, BASE = (1.14 - 1.2) / 2 + 0.957;

// Every position on the plate, in screen px. `mark` is where the mark ends (docked in the HUD, or `markTo`), with
// `size` in px per mark unit (markSVG at 2 × MARK_HALF × size, centred on x, y), so an episode can match-cut onto it.
export function seriesLayout(stage, { markTo = null } = {}) {
  const { W, CX, CY, fmt } = stage;
  const P = PLATE[fmt] || PLATE['16x9'];
  const dockU = P.hud * 0.66;                                     // the docked mark: a little taller than the HUD's caps
  const dock = { x: P.M + dockU * MARK.side, y: P.top + P.hud * 0.55, size: dockU };
  const [nx, ny, nfs] = P.number, [tx, ty, tfs] = P.title;
  const segW = (W - 2 * P.M - (EPISODES - 1) * SEG_GAP) / EPISODES;
  const fig = { top: ny + FIG_TOP * nfs, base: ny + BASE * nfs };
  return {
    fmt, M: P.M, push: 1 + PUSH,                                  // the display type's scale about the frame's centre at the cut
    counter: { x: markTo ? P.M : P.M + dockU * 1.6, top: P.top, size: P.hud },                         // "08 / 12", left-aligned
    label: { right: W - P.M, top: P.top + (P.hud - P.lab) * 0.6, size: P.lab, tracking: '.08em' },     // right-aligned
    rule: { x: P.M, y: P.rule, w: W - 2 * P.M, h: 2 },
    segments: { x: P.M, y: P.seg, w: segW, h: P.segH, gap: SEG_GAP, n: EPISODES, at: k => P.M + k * (segW + SEG_GAP) },
    number: { x: nx, top: ny, size: nfs, figTop: fig.top, baseline: fig.base },       // x nominal: its ink aligns to the title's
    title: { x: tx, top: ty, size: tfs, w: W - tx - P.M },
    glyph: { x: P.glyphX, y: Math.round(fig.top), w: W - P.M - P.glyphX, h: Math.round(fig.base - fig.top) },
    markStart: { x: CX, y: CY, size: P.mark },
    mark: markTo ? { ...markTo } : dock,
    dock,
  };
}

const lineMask = text => h('span', { class: 'line-mask' }, h('span', { text }));

export function seriesPlate(stage, { at = 0, beat = 60 / 128, number, title = '', glyph = null, markTo = null } = {}) {
  const { W, CX, CY, fmt, layers } = stage;
  const P = PLATE[fmt] || PLATE['16x9'];
  const Lo = seriesLayout(stage, { markTo });
  const C = seriesCues(beat, at);
  const dt = 0.5 / (stage.fps || 60);
  const finale = !/^\d+$/.test(String(number ?? '').trim());
  const n = finale ? EPISODES + 1 : parseInt(number, 10);
  const big = finale ? String(number || 'Docs') : String(n).padStart(2, '0');
  const emph = bezier(0.3, 0, 0, 1);

  const root = h('div', { class: 'layer', style: { background: PAPER, overflow: 'hidden' } });
  const grid = h('div', { class: 'layer', style: { backgroundImage: 'radial-gradient(circle, rgba(21,23,26,.13) 1.1px, transparent 1.6px)', backgroundSize: '24px 24px', backgroundPosition: '12px 12px' } });
  const art = h('div', { class: 'layer hero', style: { color: INK, transformOrigin: `${CX}px ${CY}px` } });       // the display type: pushes in
  const hud = h('div', { class: 'layer hero', style: { color: INK } });                                            // the HUD and the mark: hold still
  root.append(grid, art, hud);
  layers.fx.appendChild(root);

  // the HUD: counter, label, rule, the twelve segments (a track, the done fill in ink, this episode's in red)
  const counter = finale ? null : h('div', { class: 'abs', style: { left: `${Lo.counter.x}px`, top: `${P.top}px`, fontSize: `${P.hud}px`, fontWeight: 500, letterSpacing: '.02em', lineHeight: 1.1, color: SIGNAL, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }, text: `${big} / ${EPISODES}` });
  const label = h('div', { class: 'abs', style: { left: `${W - P.M - 800}px`, width: '800px', textAlign: 'right', top: `${Lo.label.top}px`, fontSize: `${P.lab}px`, fontWeight: 500, letterSpacing: '.08em', lineHeight: 1.1, color: SOFT, whiteSpace: 'nowrap' }, text: 'CUBE COMPUTER — FEATURES' });
  const rule = h('div', { class: 'abs', style: { left: `${P.M}px`, top: `${P.rule}px`, width: `${Lo.rule.w}px`, height: '2px', background: INK, transformOrigin: '0 0' } });
  const fill = color => h('i', { style: { position: 'absolute', left: 0, top: 0, bottom: 0, display: 'block', background: color, width: '0%' } });
  const segs = Array.from({ length: EPISODES }, (_, k) => {
    const done = finale || k < n - 1;
    const el = h('div', { class: 'abs', style: { left: `${Lo.segments.at(k)}px`, top: `${P.seg}px`, width: `${Lo.segments.w}px`, height: `${P.segH}px`, background: 'rgba(21,23,26,.12)', transformOrigin: '0 0', overflow: 'hidden' } });
    const ink = fill(INK), red = fill(SIGNAL);
    ink.style.width = done ? '100%' : '0%';
    el.append(ink, red);
    return { el, red, current: finale || k === n - 1 };
  });
  const markEl = markSVG(INK, { width: 2 * MARK_HALF * P.mark, height: 2 * MARK_HALF * P.mark, class: 'abs' });
  markEl.style.transformOrigin = '0 0';
  hud.append(...[counter, label, rule].filter(Boolean), ...segs.map(s => s.el), markEl);

  // the display type: the number in signal red, the title in ink, each word rising through its own mask
  const numWrap = h('div', { class: 'abs', style: { left: `${P.number[0]}px`, top: `${P.number[1]}px`, overflow: 'hidden', paddingRight: '40px' } },
    h('div', { style: { fontSize: `${P.number[2]}px`, fontWeight: 500, letterSpacing: '-0.04em', lineHeight: 1.14, color: SIGNAL, whiteSpace: 'nowrap' }, text: big }));
  const numEl = numWrap.firstChild;
  const titleText = typeof title === 'object' && title ? (title[fmt] ?? title.default ?? '') : String(title);
  const titleBox = h('div', { class: 'abs', style: { left: `${P.title[0]}px`, top: `${P.title[1]}px`, width: `${Lo.title.w}px`, fontSize: `${P.title[2]}px`, fontWeight: 500, letterSpacing: '-0.015em', lineHeight: 1.1 } });
  const words = [];
  titleText.split('\n').forEach(ln => {
    const row = h('div', {});
    titleWords(ln).forEach((w, i, arr) => { const m = lineMask(w); row.appendChild(m); words.push(m.firstChild); if (i < arr.length - 1) row.appendChild(document.createTextNode(' ')); });
    titleBox.appendChild(row);
  });
  art.append(numWrap, titleBox);
  // the glyph's slot: right-aligned on the margin, as tall as the number's figures; it rises out of the slot's foot
  let glyphRise = null, glyphFit = null;
  if (glyph) {
    const g = Lo.glyph;
    glyphFit = h('div', { style: { flex: 'none', display: 'flex', transformOrigin: '100% 50%' } }, glyph);
    glyphRise = h('div', { style: { width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'flex-end' } }, glyphFit);
    art.appendChild(h('div', { class: 'abs', style: { left: `${g.x}px`, top: `${g.y}px`, width: `${g.w}px`, height: `${g.h}px`, clipPath: 'inset(-50% -50% 0 -50%)' } }, glyphRise));
  }

  // optical alignment: the number's ink starts where the title's does (measured once the fonts are in)
  let aligned = false;
  function align() {
    aligned = true;
    const ctx = document.createElement('canvas').getContext('2d');
    const inkLeft = (txt, fs, ls) => { ctx.font = `500 ${fs}px "PP Neue Montreal"`; ctx.letterSpacing = `${ls * fs}px`; return -ctx.measureText(txt).actualBoundingBoxLeft; };
    const t0 = titleWords(titleText)[0];
    const want = P.title[0] + (t0 ? inkLeft(t0, P.title[2], -0.015) : 0);
    numWrap.style.left = `${(want - inkLeft(big, P.number[2], -0.04)).toFixed(2)}px`;
    // a glyph never leaves its slot: scale it down to fit (layout sizes, so the push and the rise don't count)
    if (glyphFit) {
      const k = Math.min(1, Lo.glyph.w / (glyphFit.offsetWidth || 1), Lo.glyph.h / (glyphFit.offsetHeight || 1));
      glyphFit.style.transform = k < 1 ? `scale(${k.toFixed(4)})` : 'none';
    }
  }

  const end = Lo.mark, start = Lo.markStart;
  const markAt = tt => { const u = emph(clamp((tt - C.dock) / C.dockDur)); return [lerp(start.x, end.x, u), lerp(start.y, end.y, u), u]; };

  function update(t) {
    const on = t >= at && t < C.end;
    show(root, on);
    if (!on) return;
    if (!aligned) align();
    // the camera never stops: the type pushes in slowly about the frame's centre
    art.style.transform = `scale(${(1 + PUSH * E.inOutSine(inv(at, C.end, t))).toFixed(5)})`;
    const gr = tw(t, at + 0.02, 0.9, E.outCubic);
    grid.style.maskImage = grid.style.webkitMaskImage = `radial-gradient(circle at 50% 50%, #000 ${(gr * 70).toFixed(1)}%, transparent ${(gr * 70 + 18).toFixed(1)}%)`;
    grid.style.opacity = gr > 0 ? 0.8 : 0;
    // the mark: centred on frame one; on beat 2 it swells a touch and docks
    const [mx, my, u] = markAt(t);
    const lift = t < C.dock + 0.12 ? 1 + 0.04 * Math.sin(Math.PI * clamp((t - C.dock + 0.12) / 0.24)) : 1;
    const unit = Math.exp(lerp(Math.log(start.size), Math.log(end.size), u)) * lift;
    markEl.style.transform = `translate(${(mx - MARK_HALF * unit).toFixed(2)}px, ${(my - MARK_HALF * unit).toFixed(2)}px) scale(${(unit / P.mark).toFixed(5)})`;
    const a = markAt(t - dt), c = markAt(t + dt);
    markEl.style.filter = motionBlur(markEl, Math.min(10, Math.abs(c[0] - a[0]) * 0.35), Math.min(10, Math.abs(c[1] - a[1]) * 0.35)) || 'none';
    // the HUD draws in
    rule.style.transform = `scaleX(${tw(t, C.hud, 0.55, E.outExpo).toFixed(4)})`;
    [[label, C.label], [counter, C.counter]].forEach(([el, t0]) => { if (!el) return; const v = tw(t, t0, 0.35, E.outExpo); put(el, { y: (1 - v) * 10, o: v }); });
    const red = tw(t, C.title, C.end - C.title - 0.05, E.inOutSine);
    segs.forEach((sg, k) => {
      sg.el.style.transform = `scaleX(${tw(t, C.run(k), 0.16, E.outCubic).toFixed(4)})`;
      const f = !sg.current ? 0 : finale ? clamp(red * EPISODES - k) : red;
      sg.red.style.width = `${(100 * f).toFixed(2)}%`;
    });
    // the number, then the title (and the glyph)
    numEl.style.transform = `translateY(${((1 - tw(t, C.number, 0.7, E.snap)) * 105).toFixed(2)}%)`;
    words.forEach((w, i) => { w.style.transform = `translateY(${((1 - tw(t, C.word(i), 0.7, E.snap)) * 105).toFixed(2)}%)`; });
    if (glyphRise) glyphRise.style.transform = `translateY(${((1 - tw(t, C.title, 0.7, E.snap)) * 105).toFixed(2)}%)`;
  }

  return { update, end: C.end, cues: C, layout: Lo, root, finale };
}

// ---------------------------------------------------------------------------------------------------------------
// Bar 8: the house end card (engine/endcard.js), with the episode's docs page small and quiet under the pill, in
// the pill's own ink: white measured only 2.5–2.8:1 on the sky there, the ink about twice that. Positions are the
// pill's (endcard.js LAYOUT: its top is `cta`, its height ctaFs + 56) plus a fixed gap, in every format.
const DOCS = { '16x9': { top: 836, fs: 27 }, '9x16': { top: 1294, fs: 32 }, '1x1': { top: 792, fs: 26 }, '4x5': { top: 930, fs: 28 } };

export function docsLine(stage, end, { url, at = end.T.land - 0.36, color = '#23201d', opacity = 0.9 } = {}) {
  const { W, CX, fmt, layers } = stage;
  const D = DOCS[fmt] || DOCS['16x9'];
  const root = h('div', { class: 'layer', style: { transformOrigin: `${CX}px ${end.lock.cy}px` } });
  const el = h('div', { class: 'abs hero', style: { left: 0, width: `${W}px`, top: `${D.top}px`, textAlign: 'center', color, fontSize: `${D.fs}px`, fontWeight: 500, letterSpacing: '0.01em' } }, lineMask(url));
  root.appendChild(el);
  layers.over.appendChild(root);
  const t0 = end.T.url + 0.15;                                    // it follows the pill in
  function update(t) {
    const on = t >= at;
    show(root, on);
    if (!on) return;
    put(root, { s: 1 + 0.018 * E.inOutSine(inv(at, stage.duration, t)) });       // drifts with the end card
    el.firstChild.firstChild.style.transform = `translateY(${((1 - tw(t, t0, 0.7, E.snap)) * 105).toFixed(2)}%)`;
    el.style.opacity = (opacity * tw(t, t0, 0.2)).toFixed(3);
  }
  return { el, update, T: { in: t0 }, layout: D };
}

// The house end card plus the docs line: endCard's options, and `docs` (the page's URL without https://).
export function seriesEnd(stage, { docs, ...opts } = {}) {
  const end = endCard(stage, opts);
  const line = docs ? docsLine(stage, end, { url: docs, at: opts.at }) : null;
  return { ...end, docs: line, update(t) { end.update(t); if (line) line.update(t); } };
}
