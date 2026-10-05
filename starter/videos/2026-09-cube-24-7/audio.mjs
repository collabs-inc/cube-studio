// Cube 24/7 — a calm, loopable music bed (no sound effects).
// 10 s = 5 bars at 120 BPM. The pad opens in daylight and closes at night,
// following the same cycle as the picture (engine/sky.js).
//   node audio.mjs soundtrack.wav
import { Synth } from '../../engine/synth.mjs';

const LOOP = 10, BEAT = 0.5, BAR = 2;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const ss = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const night = p => { p = ((p % 1) + 1) % 1; return ss(0.34, 0.45, p) * (1 - ss(0.68, 0.78, p)); };

// bar-by-bar through the day: noon, dusk, night, deep night, dawn
const CHORDS = [
  [53, 57, 60, 64, 67],   // Fmaj9      day
  [50, 57, 60, 64, 65],   // Dm9        dusk
  [46, 53, 57, 62, 65],   // Bbmaj7     night
  [43, 55, 58, 62, 65],   // Gm9        deep night
  [48, 55, 60, 64, 67],   // Cadd9      dawn → back to F
];
const ROOTS = [41, 38, 34, 31, 36];

const s = new Synth({ seconds: LOOP * 3 + 2 });
for (let k = 0; k < 3; k++) {                 // three loops; the middle one is seamless
  const off = k * LOOP;
  const cut = t => { const p = (t - off) / LOOP; return 700 + 2100 * (1 - night(p)); };
  CHORDS.forEach((ch, i) => {
    const t0 = off + i * BAR;
    s.pad(t0, BAR, ch, 0.24, { attack: 0.7, release: 1.8, cutoffFn: cut, detune: 7, send: 0.45 });
    s.bass(t0, BAR - 0.05, ROOTS[i], 0.2, { glow: 0.12, attack: 0.18, release: 0.25 });
    // a quiet eighth-note pulse: the machine keeps working, softer at night
    const tones = [ch[1] + 12, ch[2] + 12, ch[3] + 12, ch[2] + 12];
    for (let j = 0; j < 8; j++) {
      const t = t0 + j * BEAT / 2, p = (t - off) / LOOP, nt = night(p);
      s.pluck(t, tones[j % 4], (0.07 + 0.03 * (j % 2 === 0)) * (1 - 0.45 * nt), j % 2 ? 0.3 : -0.3, { bright: 1800 - 900 * nt, decay: 0.16, send: 0.4 });
    }
  });
}
s.master({ bass: 0.9, music: 1.0, verb: 0.75, duck: 0, room: 0.88, damp: 0.35 });
const out = process.argv[2] || 'soundtrack.wav';
const r = s.write(out, { from: LOOP, to: 2 * LOOP });
console.log(`wrote ${out} (${r.seconds}s, peak ${r.peak.toFixed(3)})`);
