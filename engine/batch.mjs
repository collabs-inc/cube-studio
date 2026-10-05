// Render several format/variant jobs of one composition and encode each to MP4.
//   node engine/batch.mjs videos/<comp> --jobs 16x9:social,9x16:social,16x9:clean \
//        [--audio videos/<comp>/soundtrack.wav] [--gain -3] [--name cube-24-7] [--parallel 2] [--work <dir>] [--mb 8]
//        [--resume] [--keep] [--crf 17 | --bitrate 20M] [--noise 3] [--tune film]   (encoder options, see encode.mjs)
// Writes videos/<comp>/renders/<name>-<fmt>[-<variant>].mp4 (the default variant, '' or 'social', gets no suffix).
// Each job starts from an empty frame folder (--resume keeps frames from an interrupted run) and the
// PNGs are removed once the MP4 is written (--keep leaves them).
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const HERE = path.dirname(new URL(import.meta.url).pathname);
const COMP = path.resolve(args[0]);
const name = opt('name', path.basename(COMP).replace(/^\d{4}-\d{2}-/, ''));
const jobs = opt('jobs', '16x9:').split(',').map(j => { const [fmt, variant = ''] = j.split(':'); return { fmt, variant }; });
const audio = opt('audio', null), gain = opt('gain', '0');
const parallel = parseInt(opt('parallel', '2'), 10);
// default frame folder is unique per checkout, so agents in separate worktrees never share frames
// Frames go under ~/.cache/cube-frames (CUBE_FRAMES overrides), not /tmp: on a Cube /tmp sits on the small root
// disk, and a few batches of 1080p PNGs fill it.
const FRAMES = process.env.CUBE_FRAMES || path.join(os.homedir(), '.cache', 'cube-frames');
fs.mkdirSync(FRAMES, { recursive: true });
const work = path.resolve(opt('work', path.join(FRAMES, `frames-${name}-${createHash('sha1').update(COMP).digest('hex').slice(0, 8)}`)));
const mb = opt('mb', '8');
const loops = opt('loops', '1');
// encoder options passed through to encode.mjs (see there): --crf, --bitrate, --noise, --tune
const encOpts = ['crf', 'bitrate', 'noise', 'tune'].flatMap(k => (opt(k, null) != null ? ['--' + k, opt(k)] : []));
const resume = args.includes('--resume'), keep = args.includes('--keep');
const pngs = dir => (fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => /^f\d{4}\.png$/.test(f)) : []);
const clear = dir => pngs(dir).forEach(f => fs.unlinkSync(path.join(dir, f)));

const run = (cmd, a, tag) => new Promise((res, rej) => {
  const p = spawn(cmd, a, { stdio: ['ignore', 'pipe', 'inherit'] });
  p.stdout.on('data', d => { for (const s of String(d).trim().split('\n')) if (/^(frame|done|wrote)/.test(s)) console.log(`  [${tag}] ${s}`); });
  p.on('close', c => (c === 0 ? res() : rej(new Error(`${cmd} ${a.join(' ')} → ${c}`))));
});

async function one({ fmt, variant }) {
  const tag = `${fmt}${variant && variant !== 'social' ? `-${variant}` : ''}`;
  const dir = path.join(work, tag);
  const out = path.join(COMP, 'renders', `${name}-${tag}.mp4`);
  console.log(`▸ ${tag}`);
  if (!resume) clear(dir);
  await run(process.execPath, [path.join(HERE, 'render.mjs'), COMP, 'seq', '--fmt', fmt, '--variant', variant, '--dir', dir, '--pr', '1', '--mb', mb], tag);
  await run(process.execPath, [path.join(HERE, 'encode.mjs'), '--frames', dir, '--out', out, ...(audio ? ['--audio', audio, '--gain', gain] : []), '--loops', loops, ...encOpts], tag);
  if (!keep) clear(dir);
  return out;
}

const queue = [...jobs];
const done = [];
await Promise.all(Array.from({ length: Math.min(parallel, queue.length) }, async () => {
  while (queue.length) done.push(await one(queue.shift()));
}));
console.log(done.map(f => `${path.relative(process.cwd(), f)}  ${(fs.statSync(f).size / 1e6).toFixed(1)} MB`).join('\n'));
