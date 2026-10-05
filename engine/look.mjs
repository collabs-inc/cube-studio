// Restyle a finished render with a look (engine/looks/looks.js) and keep its soundtrack.
//   node engine/look.mjs <in.mp4> --look print [--out <out.mp4>] [--parallel 2]
//   node engine/look.mjs <in.mp4> --look print --still 4.5 --out <still.png>
// Frames are decoded with ffmpeg, run through the look's shader in headless Chromium, and encoded with
// the house settings (as engine/encode.mjs). Without --out the MP4 lands next to the input as <name>-<look>.mp4.
import { chromium } from 'playwright-core';
import { spawnSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname), ROOT = path.resolve(HERE, '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const input = path.resolve(args[0] || '');
const lookName = opt('look', 'print');
const still = opt('still', null);
const parallel = Math.max(1, parseInt(opt('parallel', '2'), 10));
const out = path.resolve(opt('out', input.replace(/\.mp4$/, `-${lookName}${still != null ? '.png' : '.mp4'}`)));
const ffmpeg = process.env.FFMPEG || (await import('ffmpeg-static')).default;
if (!fs.existsSync(input)) { console.error(`look: no such file ${input}`); process.exit(1); }
const { LOOKS } = await import(path.join(HERE, 'looks', 'looks.js'));
if (!LOOKS[lookName]) { console.error(`look: unknown look "${lookName}" (${Object.keys(LOOKS).join(', ')})`); process.exit(1); }

const ff = a => { const r = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...a], { stdio: 'inherit' }); if (r.status !== 0) process.exit(r.status || 1); };
const info = spawnSync(ffmpeg, ['-hide_banner', '-i', input], { encoding: 'utf8' }).stderr;
const fps = Number(/(\d+(?:\.\d+)?) fps/.exec(info)?.[1] || 60);
const hasAudio = /Audio:/.test(info);

// working frames under ~/.cache/cube-frames (CUBE_FRAMES overrides), not the small /tmp disk; removed when done
const FRAMES = process.env.CUBE_FRAMES || path.join(os.homedir(), '.cache', 'cube-frames');
fs.mkdirSync(FRAMES, { recursive: true });
const work = fs.mkdtempSync(path.join(FRAMES, `look-${lookName}-`));
const srcDir = path.join(work, 'src'), outDir = path.join(work, 'out');
fs.mkdirSync(srcDir); fs.mkdirSync(outDir);
console.log(`look: decoding ${path.basename(input)}`);
if (still != null) ff(['-ss', String(still), '-i', input, '-frames:v', '1', path.join(srcDir, 's00001.png')]);
else ff(['-i', input, '-vsync', '0', path.join(srcDir, 's%05d.png')]);
const frames = fs.readdirSync(srcDir).filter(f => f.endsWith('.png')).sort();
const png = fs.readFileSync(path.join(srcDir, frames[0]));
const W = png.readUInt32BE(16), H = png.readUInt32BE(20);

// a tiny server: the look page and looks.js, the brand fonts, and the decoded frames
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.woff2': 'font/woff2' };
const srv = http.createServer((req, res) => {
  const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const f = u.startsWith('/looks/') ? path.join(HERE, 'looks', u.slice(7)) : u.startsWith('/brand/') ? path.join(ROOT, u) : u.startsWith('/f/') ? path.join(srcDir, u.slice(3)) : null;
  if (!f || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
}).listen(0, '127.0.0.1');
await new Promise(r => srv.on('listening', r));
const base = `http://127.0.0.1:${srv.address().port}`;

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--force-color-profile=srgb'] });
async function worker(list) {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  page.on('pageerror', e => console.error('look page:', e.message));
  await page.goto(`${base}/looks/page.html`);
  await page.waitForFunction(() => window.lookReady);
  await page.evaluate(([n, w, h]) => window.setup(n, w, h), [lookName, W, H]);
  for (const [i, f] of list) {
    await page.evaluate(([u, t]) => window.draw(u, t), [`/f/${f}`, i / fps]);
    await page.screenshot({ path: still != null ? out : path.join(outDir, `f${String(i).padStart(4, '0')}.png`), clip: { x: 0, y: 0, width: W, height: H } });
    if (i % 60 === 0) console.log(`look: frame ${i}/${frames.length}`);
  }
  await page.close();
}
const jobs = frames.map((f, i) => [i, f]);
const lanes = Array.from({ length: Math.min(parallel, jobs.length) }, (_, k) => jobs.filter((_, i) => i % parallel === k));
await Promise.all(lanes.map(worker));
await browser.close(); srv.close();

if (still == null) {
  console.log('look: encoding');
  const a = ['-framerate', String(fps), '-i', path.join(outDir, 'f%04d.png')];
  if (hasAudio) a.push('-i', input, '-map', '0:v', '-map', '1:a', '-c:a', 'copy');
  a.push('-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-profile:v', 'high', '-g', String(fps), '-bf', '2',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv', '-movflags', '+faststart', out);
  ff(a);
}
fs.rmSync(work, { recursive: true, force: true });
console.log('wrote', out, `${(fs.statSync(out).size / 1e6).toFixed(1)} MB`);
