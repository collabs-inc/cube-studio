// A small, deterministic synth kit for soundtracks (Node). Same voices as the
// first reel's audio.mjs, packaged so a composition only writes its arrangement:
//
//   const s = new Synth({ seconds: 30 });
//   s.pad(t0, dur, [53, 57, 60, 64], 0.2, { cutoffFn: t => 1800 });
//   s.bass(t0, dur, 41, 0.4); s.pluck(t0, 69, 0.1);
//   s.master({ drums: 0.5, bass: 0.8, music: 0.95, verb: 0.6 });
//   s.write('out.wav', { from: 10, to: 20 });   // e.g. the middle of three loops = seamless
import fs from 'node:fs';

export const SR = 48000;
const TAU = Math.PI * 2;
export const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const panG = p => [Math.cos((p + 1) * Math.PI / 4), Math.sin((p + 1) * Math.PI / 4)];
export function mulberry(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export class Biquad {
  constructor(type = 'lp', f = 1000, q = 0.707, gain = 0) { this.x1 = this.x2 = this.y1 = this.y2 = 0; this.set(type, f, q, gain); }
  set(type, f, q = 0.707, gain = 0) {
    f = clamp(f, 10, SR * 0.45);
    const w = TAU * f / SR, cs = Math.cos(w), sn = Math.sin(w), al = sn / (2 * q), A = Math.pow(10, gain / 40);
    let b0, b1, b2, a0, a1, a2;
    if (type === 'lp') { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = (1 - cs) / 2; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; }
    else if (type === 'hp') { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = (1 + cs) / 2; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; }
    else if (type === 'bp') { b0 = al; b1 = 0; b2 = -al; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; }
    else { const s2 = 2 * Math.sqrt(A) * al; b0 = A * ((A + 1) - (A - 1) * cs + s2); b1 = 2 * A * ((A - 1) - (A + 1) * cs); b2 = A * ((A + 1) - (A - 1) * cs - s2); a0 = (A + 1) + (A - 1) * cs + s2; a1 = -2 * ((A - 1) + (A + 1) * cs); a2 = (A + 1) + (A - 1) * cs - s2; }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0;
  }
  p(x) { const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2; this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y; return y; }
}
function blep(t, dt) { if (t < dt) { t /= dt; return t + t - t * t - 1; } if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; } return 0; }
export class Saw { constructor(f, ph = 0) { this.ph = ph; this.f = f; } s() { const dt = this.f / SR; const v = 2 * this.ph - 1 - blep(this.ph, dt); this.ph += dt; if (this.ph >= 1) this.ph -= 1; return v; } }

function freeverb(inL, inR, len, { room = 0.86, damp = 0.3 } = {}) {
  const sc = SR / 44100;
  const combT = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map(v => Math.round(v * sc));
  const apT = [556, 441, 341, 225].map(v => Math.round(v * sc));
  const mk = sp => ({ combs: combT.map(n => ({ b: new Float32Array(n + sp), i: 0, s: 0 })), aps: apT.map(n => ({ b: new Float32Array(n + sp), i: 0 })) });
  const chL = mk(0), chR = mk(23);
  const outL = new Float32Array(len), outR = new Float32Array(len);
  const run = (ch, x) => {
    let o = 0;
    for (const c of ch.combs) { const y = c.b[c.i]; c.s = y * (1 - damp) + c.s * damp; c.b[c.i] = x + c.s * room; if (++c.i >= c.b.length) c.i = 0; o += y; }
    for (const a of ch.aps) { const bo = a.b[a.i]; const y = -o + bo; a.b[a.i] = o + bo * 0.5; if (++a.i >= a.b.length) a.i = 0; o = y; }
    return o;
  };
  for (let i = 0; i < len; i++) { const x = (inL[i] + inR[i]) * 0.015; outL[i] = run(chL, x); outR[i] = run(chR, x); }
  return [outL, outR];
}

export class Synth {
  constructor({ seconds, seed = 1234 } = {}) {
    this.len = Math.ceil(seconds * SR);
    const bus = () => [new Float32Array(this.len), new Float32Array(this.len)];
    this.bus = { drums: bus(), bass: bus(), music: bus(), fx: bus(), verb: bus() };
    this.kickEnv = new Float32Array(this.len);
    this.rnd = mulberry(seed);
  }
  noise() { return this.rnd() * 2 - 1; }
  place(B, t0, dur, gen, gain = 1, pan = 0) {
    const [gl, gr] = panG(pan), i0 = Math.round(t0 * SR), n = Math.round(dur * SR);
    for (let i = 0; i < n; i++) { const k = i0 + i; if (k < 0 || k >= this.len) continue; const v = gen(i, i / SR) * gain; B[0][k] += v * gl; B[1][k] += v * gr; }
  }
  placeStereo(B, t0, dur, gen, gain = 1) {
    const i0 = Math.round(t0 * SR), n = Math.round(dur * SR);
    for (let i = 0; i < n; i++) { const k = i0 + i; if (k < 0 || k >= this.len) continue; const [l, r] = gen(i, i / SR); B[0][k] += l * gain; B[1][k] += r * gain; }
  }
  // Detuned-saw chord pad through a (optionally moving) lowpass.
  pad(t0, dur, notes, g = 1, { cutoff = 1800, attack = 0.35, release = 0.9, cutoffFn = null, detune = 9, send = 0.35 } = {}) {
    const voices = [];
    notes.forEach((m, k) => { for (const d of [-detune, 0, detune]) voices.push({ o: new Saw(mtof(m) * Math.pow(2, d / 1200), this.rnd()), pan: ((k / Math.max(1, notes.length - 1)) * 2 - 1) * 0.6 + d / 40 }); });
    const lpL = new Biquad('lp', cutoff, 0.8), lpR = new Biquad('lp', cutoff, 0.8);
    const gen = (i, t) => {
      if (i % 64 === 0) { const c = cutoffFn ? cutoffFn(t0 + t) : cutoff; lpL.set('lp', c, 0.8); lpR.set('lp', c, 0.8); }
      let l = 0, r = 0;
      for (const v of voices) { const s = v.o.s(); const [gl, gr] = panG(v.pan); l += s * gl; r += s * gr; }
      const a = Math.min(1, t / attack) * (t > dur ? Math.exp(-(t - dur) / (release * 0.4)) : 1), n = 1 / Math.sqrt(voices.length);
      return [lpL.p(l) * a * n, lpR.p(r) * a * n];
    };
    const buf = [];
    this.placeStereo(this.bus.music, t0, dur + release, (i, t) => { const v = gen(i, t); buf.push(v); return v; }, g);
    if (send) { let j = 0; this.placeStereo(this.bus.verb, t0, dur + release, () => buf[j++] || [0, 0], g * send); }
  }
  bass(t0, dur, midi, g = 1, { glow = 0.35, attack = 0.006, release = 0.02 } = {}) {
    let ph = 0; const o = new Saw(mtof(midi)); const lp = new Biquad('lp', 240, 0.9); const f = mtof(midi);
    this.place(this.bus.bass, t0, dur + release * 4, (i, t) => { ph += TAU * f / SR; const a = Math.min(1, t / attack) * (t > dur ? Math.exp(-(t - dur) / release) : 1); return (Math.sin(ph) * 0.85 + lp.p(o.s()) * glow) * a; }, g);
  }
  pluck(t0, midi, g = 1, pan = 0, { bright = 3200, decay = 0.13, send = 0.3, cutoffMul = 1 } = {}) {
    const o = new Saw(mtof(midi)), o2 = new Saw(mtof(midi) * 1.004), lp = new Biquad('lp', bright, 1.1);
    const gen = (i, t) => { if (i % 16 === 0) lp.set('lp', (300 + bright * Math.exp(-t / 0.05)) * cutoffMul, 1.1); return lp.p(o.s() + o2.s()) * 0.5 * Math.exp(-t / decay); };
    const buf = [];
    this.place(this.bus.music, t0, decay * 3, (i, t) => { const v = gen(i, t); buf.push(v); return v; }, g, pan);
    if (send) { let j = 0; this.place(this.bus.verb, t0, decay * 3, () => buf[j++] || 0, g * send, pan); }
  }
  kick(t0, g = 1) {
    let ph = 0; const hp = new Biquad('hp', 2500, 0.7);
    this.place(this.bus.drums, t0, 0.55, (i, t) => { const f = 46 + 125 * Math.exp(-t / 0.032) + 60 * Math.exp(-t / 0.004); ph += TAU * f / SR; const a = Math.min(1, t / 0.0012) * Math.exp(-t / 0.3); const click = hp.p(this.noise()) * Math.exp(-t / 0.0025) * 0.35; return Math.tanh(1.7 * (Math.sin(ph) * a + click)) * 0.95; }, g);
    const i0 = Math.round(t0 * SR);
    for (let i = 0; i < 0.3 * SR; i++) { const k = i0 + i; if (k < this.len) this.kickEnv[k] = Math.max(this.kickEnv[k], Math.exp(-i / SR / 0.11) * g); }
  }
  // Sum buses, reverb, gentle glue, look-ahead limiter at -1 dBFS.
  master({ drums = 0.5, bass = 0.8, music = 0.95, fx = 0.62, verb = 0.6, duck = 0.55, room = 0.86, damp = 0.3 } = {}) {
    const L = this.len, B = this.bus;
    const [rvL, rvR] = freeverb(B.verb[0], B.verb[1], L, { room, damp });
    const out = [new Float32Array(L), new Float32Array(L)];
    const hp = [new Biquad('hp', 28, 0.7), new Biquad('hp', 28, 0.7)];
    for (let i = 0; i < L; i++) {
      const d = 1 - duck * this.kickEnv[i];
      for (let c = 0; c < 2; c++) {
        const v = B.drums[c][i] * drums + B.bass[c][i] * bass * d + B.music[c][i] * music * d + B.fx[c][i] * fx + (c ? rvR[i] : rvL[i]) * verb;
        out[c][i] = Math.tanh(hp[c].p(v) * 1.1) / Math.tanh(1.1);
      }
    }
    const ceiling = Math.pow(10, -1 / 20), look = Math.round(0.004 * SR), rel = Math.exp(-1 / (0.08 * SR));
    const need = new Float32Array(L);
    for (let i = 0; i < L; i++) { const a = Math.max(Math.abs(out[0][i]), Math.abs(out[1][i])); need[i] = a > ceiling ? ceiling / a : 1; }
    let gain = 1;
    for (let i = 0; i < L; i++) {
      let m = 1; for (let k = 0; k < look && i + k < L; k += 4) m = Math.min(m, need[i + k]);
      gain = m < gain ? m : 1 - (1 - gain) * rel;
      out[0][i] *= gain; out[1][i] *= gain;
    }
    this.out = out;
    return out;
  }
  // Write [from, to) seconds as 16-bit stereo WAV, peak-normalised to -1 dBFS.
  write(file, { from = 0, to = this.len / SR, fadeIn = 0, fadeOut = 0 } = {}) {
    const i0 = Math.round(from * SR), n = Math.round((to - from) * SR), [L, R] = this.out;
    let peak = 0; for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(L[i0 + i]), Math.abs(R[i0 + i]));
    const norm = Math.pow(10, -1 / 20) / (peak || 1);
    const buf = Buffer.alloc(44 + n * 4);
    buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
    buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
    buf.write('data', 36); buf.writeUInt32LE(n * 4, 40);
    for (let i = 0; i < n; i++) {
      const t = i / SR, f = Math.min(fadeIn ? Math.min(1, t / fadeIn) : 1, fadeOut ? Math.min(1, (n / SR - t) / fadeOut) : 1);
      for (let c = 0; c < 2; c++) {
        const v = (c ? R : L)[i0 + i] * norm * f + (this.rnd() - this.rnd()) / 32768;
        buf.writeInt16LE(Math.round(clamp(v, -1, 1) * 32767), 44 + i * 4 + c * 2);
      }
    }
    fs.writeFileSync(file, buf);
    return { peak, seconds: n / SR };
  }
}
