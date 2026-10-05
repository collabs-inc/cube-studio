// The feature series' music at both ends, so every episode opens and closes identically: the plate's bar
// (plateSting) and the pickup into the end card and the card itself (endBlock), note for note from the finale's
// score (videos/2026-10-cube-docs/audio.mjs), in the brand reel's house sound at 128 BPM. Music only; every note
// sits on an accent of engine/series.js (the same seriesCues). For engine/synth.mjs:
//
//   import { Synth } from '../../engine/synth.mjs';
//   import { plateSting, endBlock, seriesVoices, SERIES_MASTER } from '../../engine/series-audio.mjs';
//   const s = new Synth({ seconds: DURATION + 3, seed: 1427 });
//   plateSting(s, 0, { beat: BEAT, title: 'Localhost previews' });     // bar 1, and the kick + stab on the cut
//   …the episode's own score (seriesVoices(s) has the house voices: hat, clap, snare, crash, stab, …)…
//   endBlock(s, T.impact, { beat: BEAT, until: DURATION });             // the snare pickup, then bar 8 home on F
//   s.master(SERIES_MASTER); s.write(out, { from: 0, to: DURATION, fadeOut: 0.6 });
//
// `on: stem => bool` keeps a STEM=pad|pluck|bass|drums workflow; `mix` scales the voices (the finale's balance by
// default: plucks forward, the pad under them).
import { Biquad, mtof, SR } from './synth.mjs';
import { seriesCues, titleWords, EPISODES } from './series-cues.js';

export { seriesCues };
export const SERIES_MASTER = { drums: 0.42, bass: 0.72, music: 1.0, verb: 0.62, duck: 0.5, room: 0.86, damp: 0.3 };
export const SERIES_MIX = { pluck: 2.05, stab: 1.2, pad: 0.68, bass: 1.1 };
// D minor resolving to F: the reel's colour
export const CH = {
  Dm9: [50, 57, 60, 64, 65], Bbmaj7: [46, 53, 57, 62, 65], F: [53, 57, 60, 65, 69],
  C: [48, 55, 60, 64, 67], Gm7: [43, 50, 58, 62, 65], Fadd9: [41, 53, 57, 60, 67, 69],
};
export const PENT = [62, 65, 67, 69, 72, 74, 77, 79, 81, 84, 86, 89, 91, 93];
const TITLE_NOTES = [77, 79, 81, 84, 86, 89, 91, 93];
const TAU = Math.PI * 2;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

// The house voices (the brand reel's, as packaged by cube-ssh and cube-ports), bound to one Synth.
export function seriesVoices(s, { on = () => true, mix = SERIES_MIX } = {}) {
  const M = { ...SERIES_MIX, ...mix };
  function hat(t0, g = 1, open = false, pan = 0.15) {
    if (!on('drums')) return;
    const hp = new Biquad('hp', 7800, 0.8), hp2 = new Biquad('hp', 9000, 0.7);
    const fr = [410.6, 608.8, 739.2, 1045.4, 1080, 1600], ph = fr.map(() => s.rnd());
    const d = open ? 0.19 : 0.028;
    s.place(s.bus.drums, t0, open ? 0.5 : 0.09, (i, t) => {
      let m = 0; for (let k = 0; k < 6; k++) { ph[k] += fr[k] / SR; m += (ph[k] % 1 < 0.5 ? 1 : -1); }
      return hp2.p(hp.p(s.noise() * 0.7 + m * 0.08)) * Math.exp(-t / d) * 0.8;
    }, g, pan);
  }
  function clap(t0, g = 1, pan = 0.05) {
    if (!on('drums')) return;
    const bp = new Biquad('bp', 1250, 0.9), hp = new Biquad('hp', 700, 0.7);
    s.place(s.bus.drums, t0, 0.45, (i, t) => {
      let e = 0; for (const o of [0, 0.011, 0.022]) if (t >= o) e = Math.max(e, Math.exp(-(t - o) / 0.006));
      e = Math.max(e, t > 0.025 ? 0.55 * Math.exp(-(t - 0.025) / 0.11) : 0);
      return hp.p(bp.p(s.noise())) * e * 2.2;
    }, g, pan);
    const bp2 = new Biquad('bp', 1250, 0.9);
    s.place(s.bus.verb, t0, 0.2, (i, t) => bp2.p(s.noise()) * Math.exp(-t / 0.04) * 0.9, g * 0.5, pan);
  }
  function snare(t0, g = 1, pan = 0) {
    if (!on('drums')) return;
    const bp = new Biquad('bp', 1900, 0.8); let ph = 0;
    s.place(s.bus.drums, t0, 0.25, (i, t) => { ph += TAU * (185 + 60 * Math.exp(-t / 0.01)) / SR; return bp.p(s.noise()) * 1.6 * Math.exp(-t / 0.075) + Math.sin(ph) * 0.6 * Math.exp(-t / 0.05); }, g, pan);
  }
  function crash(t0, g = 1, dur = 2.2) {
    if (!on('drums')) return;
    const n = Math.round(dur * SR), L = new Float32Array(n), R = new Float32Array(n);
    const hpL = new Biquad('hp', 4200, 0.6), hpR = new Biquad('hp', 4200, 0.6), pk = new Biquad('peak', 7500, 1.2, 5), pk2 = new Biquad('peak', 7500, 1.2, 5);
    const fr = [205.3, 304.4, 369.6, 522.7, 540, 800].map(f => f * 1.3 * 3.1), ph = fr.map(() => s.rnd());
    for (let i = 0; i < n; i++) {
      const t = i / SR; let m = 0; for (let k = 0; k < 6; k++) { ph[k] += fr[k] / SR; m += (ph[k] % 1 < 0.5 ? 1 : -1); }
      const e = Math.exp(-t / (dur * 0.33)) * Math.min(1, t / 0.002);
      L[i] = pk.p(hpL.p(s.noise() + m * 0.1)) * e * 0.5; R[i] = pk2.p(hpR.p(s.noise() + m * 0.1)) * e * 0.5;
    }
    s.placeStereo(s.bus.drums, t0, dur, i => [L[i], R[i]], g);
    s.placeStereo(s.bus.verb, t0, dur, i => [L[i], R[i]], g * 0.25);
  }
  const kick = (t0, g = 1) => { if (on('drums')) s.kick(t0, g); };
  // a short chord hit: detuned saws through a snapping lowpass (on the pluck stem)
  function stab(t0, notes, g = 1, bright = 4200, decay = 0.12) {
    if (!on('pluck')) return;
    const os = notes.flatMap(m => [0, 1].map(k => ({ f: mtof(m) * (k ? 1.006 : 1), ph: s.rnd() })));
    const lp = new Biquad('lp', 3000, 1.0);
    const buf = [];
    s.place(s.bus.music, t0, decay * 3.4, (i, t) => {
      if (i % 16 === 0) lp.set('lp', 500 + bright * Math.exp(-t / 0.05), 1.0);
      let v = 0; for (const o of os) { o.ph += o.f / SR; v += 2 * (o.ph % 1) - 1; }
      const y = lp.p(v) / os.length * 2.2 * Math.exp(-t / decay); buf.push(y); return y;
    }, g * M.stab);
    let j = 0; s.place(s.bus.verb, t0, decay * 3.4, () => buf[j++] || 0, g * M.stab * 0.4);
  }
  const pluck = (t0, m, g, pan = 0, o = {}) => { if (on('pluck')) s.pluck(t0, m, g * M.pluck, pan, o); };
  const pad = (t0, d, notes, g, o) => { if (on('pad')) s.pad(t0, d, notes, g * M.pad, o); };
  const bass = (t0, d, m, g, o) => { if (on('bass')) s.bass(t0, d, m, g * M.bass, o); };
  return { hat, clap, snare, crash, kick, stab, pluck, pad, bass };
}

// Bar 1, the plate, on Dm9: frame one is a chord (the mark); the twelve segments draw in as a run up the
// pentatonic; a pluck as the mark docks; the number lands on a stab; a pluck per word of the title; hats on the
// back half and a two-snare pickup into the cut. `downbeat` adds the cut itself: kick and a B♭maj7 stab.
export function plateSting(s, at = 0, { beat = 60 / 128, title = '', words, downbeat = true, on, mix } = {}) {
  const v = seriesVoices(s, { on, mix }), C = seriesCues(beat, at), BAR = 4 * beat;
  const n = words ?? titleWords(title).length;
  v.stab(at, [62, 65, 69, 72, 76], 0.26, 3000, 0.3);
  v.pluck(at + 0.004, 86, 0.06, 0.2, { bright: 2600, decay: 0.6, send: 0.8 });
  v.pad(at, BAR + 0.1, CH.Dm9, 0.18, { attack: 0.06, release: 0.8, cutoffFn: t => 600 + 1600 * clamp((t - at) / BAR, 0, 1), send: 0.5 });
  v.bass(at, BAR - 0.08, 38, 0.18, { glow: 0.08, attack: 0.04, release: 0.5 });
  for (let k = 0; k < EPISODES; k++) v.pluck(C.run(k), PENT[k % PENT.length], 0.03 + 0.003 * k, -0.5 + k / 12, { bright: 2000 + 90 * k, decay: 0.07, send: 0.4 });
  v.pluck(C.dock, 74, 0.08, -0.2, { bright: 2200, decay: 0.2, send: 0.5 });
  v.stab(C.number, [65, 69, 74, 77], 0.32, 4000);
  v.pluck(C.number + 0.004, 89, 0.06, 0.25, { bright: 3000, decay: 0.45, send: 0.7 });
  for (let k = 0; k < n; k++) v.pluck(C.word(k), TITLE_NOTES[Math.min(k, TITLE_NOTES.length - 1)], 0.07, n > 1 ? -0.4 + 0.8 * k / (n - 1) : 0, { bright: 2400, decay: 0.18, send: 0.5 });
  for (let k = 0; k < 4; k++) v.hat(at + 2 * beat + k * beat / 2, 0.05 + 0.03 * k, false, k % 2 ? 0.3 : -0.3);
  v.snare(at + 3.75 * beat, 0.07); v.snare(at + 3.875 * beat, 0.1);
  if (downbeat) { v.kick(C.end, 0.95); v.stab(C.end, [62, 65, 70, 74], 0.26, 3600); }
  return C;
}

// The end: a snare pickup through the last beat of bar 7 (`pickup`), then bar 8 home on Fadd9: kick and crash on
// the impact, sub on F, a run as the wordmark wipes out, a pluck as the pill lands, two on its glint, and one for the
// docs line (`docs`), on engine/endcard.js's timings. `until` is where the piece ends (default: a bar later).
export function endBlock(s, at, { beat = 60 / 128, until, pickup = true, docs = true, on, mix } = {}) {
  const v = seriesVoices(s, { on, mix }), dur = (until ?? at + 4 * beat) - at;
  if (pickup) { const t0 = at - beat; for (let t = t0; t < at - 0.01; t += beat / 8) { const u = (t - t0) / beat; v.snare(t, 0.08 + 0.24 * u * u, (s.rnd() - 0.5) * 0.3); } }
  v.kick(at, 1.0); v.crash(at, 0.34, 2.4);
  v.pad(at, dur, CH.Fadd9, 0.3, { attack: 0.02, release: 1.1, cutoffFn: t => 1400 + 2200 * Math.exp(-(t - at) / 0.9), send: 0.5 });
  v.bass(at, dur - 0.2, 29, 0.42, { glow: 0.3, attack: 0.01, release: 0.6 });
  const W0 = at + 0.56, URL = at + beat + 0.36, GLINT = URL + 0.42;          // endcard.js: word, url, glint
  [65, 69, 72, 77, 81].forEach((m, k) => v.pluck(W0 + k * 0.075, m, 0.12 - k * 0.012, -0.4 + k * 0.2, { bright: 2600, decay: 0.5, send: 0.7 }));
  v.pluck(URL, 81, 0.11, 0, { bright: 2600, decay: 0.4, send: 0.6 });
  [84, 89].forEach((m, k) => v.pluck(GLINT + k * 0.12, m, 0.05, -0.2 + k * 0.4, { bright: 3000, decay: 0.5, send: 0.8 }));
  if (docs) v.pluck(URL + 0.15, 77, 0.05, 0.1, { bright: 2200, decay: 0.4, send: 0.6 });
  return { at, url: URL, glint: GLINT, docs: URL + 0.15 };
}
