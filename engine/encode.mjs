// PNG sequence (+ optional soundtrack) → H.264/AAC MP4, BT.709, light temporal grain.
//   node engine/encode.mjs --frames <dir> --out <file.mp4> [--audio <wav>] [--gain -1.3] [--fps 60] [--duration 15] [--loops 1]
//        [--crf 17 | --bitrate 20M] [--noise 3] [--tune film]
// Grain-heavy pieces: --noise 0 (their own grain is enough), --tune grain, and --bitrate (two-pass) to keep files
// under GitHub's 100 MB limit.
// --loops N repeats the frames N times (seamless loops exported longer for social).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const ffmpeg = process.env.FFMPEG || (await import('ffmpeg-static')).default;
const frames = path.resolve(opt('frames', 'frames'));
const out = path.resolve(opt('out', 'out.mp4'));
const audio = opt('audio', null);
const gain = parseFloat(opt('gain', '0'));
const fps = opt('fps', '60');
const loops = parseInt(opt('loops', '1'), 10);
const n = fs.readdirSync(frames).filter(f => /^f\d{4}\.png$/.test(f)).length;
const duration = parseFloat(opt('duration', String((n / parseFloat(fps)) * loops)));
fs.mkdirSync(path.dirname(out), { recursive: true });

const a = ['-hide_banner', '-loglevel', 'error', '-y'];
if (loops > 1) a.push('-stream_loop', String(loops - 1));
a.push('-framerate', fps, '-i', path.join(frames, 'f%04d.png'));
if (audio) { if (loops > 1) a.push('-stream_loop', String(loops - 1)); a.push('-i', path.resolve(audio)); }
const noise = parseFloat(opt('noise', '3')), bitrate = opt('bitrate', null);
a.push('-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p' + (noise > 0 ? `,noise=c0s=${noise}:c0f=t` : ''));
const vcodec = ['-c:v', 'libx264', '-preset', 'slow', '-profile:v', 'high', '-tune', opt('tune', 'film'), '-g', fps, '-bf', '2',
  '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv'];
if (bitrate) {
  // two-pass at a fixed bitrate: a predictable file size for grain that CRF would spend 100 MB+ on
  const log = path.join(path.dirname(out), `.x264-${path.basename(out)}`);
  const p1 = [...a, ...vcodec, '-b:v', bitrate, '-pass', '1', '-passlogfile', log, '-an', '-f', 'mp4', '-t', String(duration), '/dev/null'];
  const r1 = spawnSync(ffmpeg, p1, { stdio: 'inherit' });
  if (r1.status !== 0) process.exit(r1.status || 1);
  a.push(...vcodec, '-b:v', bitrate, '-pass', '2', '-passlogfile', log);
  process.on('exit', () => { for (const f of fs.readdirSync(path.dirname(out))) if (f.startsWith(path.basename(log))) fs.rmSync(path.join(path.dirname(out), f), { force: true }); });
} else a.push(...vcodec, '-crf', opt('crf', '17'));
if (audio) a.push('-af', `volume=${gain}dB,alimiter=limit=0.89:level=false`, '-c:a', 'aac', '-b:a', '256k', '-ar', '48000');
a.push('-movflags', '+faststart', '-t', String(duration), out);
const r = spawnSync(ffmpeg, a, { stdio: 'inherit' });
if (r.status !== 0) process.exit(r.status || 1);
console.log('wrote', out, `${(fs.statSync(out).size / 1e6).toFixed(1)} MB`);
