// Render any composition frame by frame in headless Chromium.
//
//   node engine/render.mjs <composition dir> stills 0.5,1.2 [--fmt 9x16] [--variant clean] [--pr 0.5] [--out dir]
//   node engine/render.mjs <composition dir> seq --i0 0 --i1 600 --dir frames [--fmt 1x1] [--mb 16]
//   node engine/render.mjs <composition dir> video --out renders/x.mp4 [--audio soundtrack.wav] [--fmt 9x16]
//
// The piece's project is served (its engine/ and brand/ win over the app's, see paths.mjs) and the
// composition's page (index.html, or reel.html for the first reel) is opened
// with ?fmt=&variant=&pr=&mb=. A page must set window.reelReady and expose
// window.renderFrame(t) and window.reelInfo = { DURATION, FPS }.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { serve } from './serve.mjs';
import { projectRootOf } from './paths.mjs';

export const FORMATS = { '16x9': [1920, 1080], '9x16': [1080, 1920], '1x1': [1080, 1080], '4x5': [1080, 1350] };
const ffmpegPath = async () => process.env.FFMPEG || (await import('ffmpeg-static')).default;

const args = process.argv.slice(2);
const COMP = path.resolve(args[0] || '.');
const mode = args[1];
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const pr = parseFloat(opt('pr', '1'));
const fmt = opt('fmt', '16x9');
const variant = opt('variant', '');
const mb = opt('mb', '8');
if (!FORMATS[fmt]) throw new Error(`unknown --fmt ${fmt} (${Object.keys(FORMATS).join(', ')})`);
const [VW, VH] = FORMATS[fmt];
const pageFile = opt('page', fs.existsSync(path.join(COMP, 'index.html')) ? 'index.html' : 'reel.html');
const ROOT = projectRootOf(COMP);
if (!ROOT) throw new Error(`${COMP} is not a piece: expected <project>/videos/<piece>`);
const rel = path.relative(ROOT, COMP).split(path.sep).join('/');

const { srv, url } = await serve(ROOT);
const browser = await chromium.launch({ args: ['--disable-gpu-vsync', '--disable-frame-rate-limit', '--force-color-profile=srgb', '--font-render-hinting=none'] });
const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: pr });
const page = await ctx.newPage();
page.on('pageerror', e => console.error('pageerror:', e.message));
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') { const s = m.text(); if (!/GPU stall|GL Driver/.test(s)) console.error('console:', s); } });
await page.goto(`${url}/${rel}/${pageFile}?pr=${pr}&mb=${mb}&fmt=${fmt}&variant=${encodeURIComponent(variant)}`);
await page.waitForFunction(() => window.reelReady === true, null, { timeout: 180000 });
const info = await page.evaluate(() => window.reelInfo || { DURATION: 10, FPS: 60 });
const cdp = await ctx.newCDPSession(page);
// warm-up: visit the timeline once so lazily loaded images are decoded
for (let k = 0; k <= 8; k++) { await page.evaluate(t => window.renderFrame(t), (k / 8) * info.DURATION * 0.999); await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 10 }); }
await page.waitForTimeout(300);

async function frame(t) {
  const n = await page.evaluate(t => window.renderFrame(t), t);
  const r = await cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true, captureBeyondViewport: false });
  return { buf: Buffer.from(r.data, 'base64'), n };
}

try {
  if (mode === 'stills') {
    const times = args[2].split(',').map(Number);
    const out = path.resolve(opt('out', path.join(COMP, 'stills')));
    fs.mkdirSync(out, { recursive: true });
    for (const t of times) {
      const t0 = Date.now();
      const { buf, n } = await frame(t);
      const f = path.join(out, `t${t.toFixed(3).padStart(7, '0')}.png`);
      fs.writeFileSync(f, buf);
      console.log(`${f}  (${Date.now() - t0} ms, ${n} sub)`);
    }
  } else if (mode === 'seq') {
    const fps = parseFloat(opt('fps', String(info.FPS)));
    const i0 = parseInt(opt('i0', '0'), 10), i1 = parseInt(opt('i1', String(Math.round(info.DURATION * fps))), 10);
    const dir = path.resolve(opt('dir', path.join(COMP, 'frames')));
    fs.mkdirSync(dir, { recursive: true });
    const t0 = Date.now();
    for (let i = i0; i < i1; i++) {
      const f = path.join(dir, `f${String(i).padStart(4, '0')}.png`);
      if (fs.existsSync(f) && fs.statSync(f).size > 1000) continue;
      const { buf, n } = await frame(i / fps);
      fs.writeFileSync(f + '.tmp', buf); fs.renameSync(f + '.tmp', f);
      if (i % 20 === 0) console.log(`frame ${i} t=${(i / fps).toFixed(3)} sub=${n} elapsed=${((Date.now() - t0) / 1000).toFixed(0)}s`);
    }
    console.log('done', i0, i1, `${((Date.now() - t0) / 1000).toFixed(0)}s`);
  } else if (mode === 'video') {
    const fps = parseFloat(opt('fps', String(info.FPS)));
    const from = parseFloat(opt('from', '0')), to = parseFloat(opt('to', String(info.DURATION)));
    const out = path.resolve(opt('out', path.join(COMP, 'renders', `out-${fmt}.mp4`)));
    const audio = opt('audio', null);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const ff = spawn(await ffmpegPath(), ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'png', '-i', '-',
      ...(audio ? ['-i', path.resolve(audio)] : []),
      '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p,noise=c0s=3:c0f=t',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', opt('crf', '17'), '-profile:v', 'high', '-tune', 'film',
      '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv', '-movflags', '+faststart',
      ...(audio ? ['-c:a', 'aac', '-b:a', '256k', '-af', 'alimiter=limit=0.89:level=false', '-shortest'] : []),
      out], { stdio: ['pipe', 'inherit', 'inherit'] });
    const N = Math.round((to - from) * fps);
    const t0 = Date.now();
    for (let i = 0; i < N; i++) {
      const { buf, n } = await frame(from + i / fps);
      if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
      if (i % 60 === 0) console.log(`frame ${i}/${N} sub=${n} elapsed=${((Date.now() - t0) / 1000).toFixed(0)}s`);
    }
    ff.stdin.end();
    await new Promise(r => ff.on('close', r));
    console.log('wrote', out, `${((Date.now() - t0) / 1000).toFixed(0)}s`);
  } else {
    console.error('mode must be stills | seq | video');
  }
} finally {
  await browser.close();
  srv.close();
}
