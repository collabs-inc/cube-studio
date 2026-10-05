// Cube Studio — a web app over your video projects: talk to the Director, preview compositions live,
// switch format/variant, render jobs, and play or download the results.
//   npm run studio            → http://127.0.0.1:4173   (as a Cube app: $PORT, behind Cube's gate)
//
// One Studio sees every project (~/Studio and the others in paths.mjs) and every checkout of each: the main
// one and each git worktree the agents work in. A piece is listed from the worktree whose branch changes it
// (else from main), with a status worked out from its files and the processes rendering it. Each checkout is
// served under /wt/<name>/, with its absolute /engine/, /brand/ and /videos/ paths rewritten into that prefix,
// so a piece previews on its own branch's engine (or the app's, where the project has none).
//
// Notes: you pin a note to a moment of a piece. Notes live in <state>/notes/<checkout>__<piece>.json, and every
// new one goes to the Director (the kit's persona, kit/persona.mjs), which hands it to whoever is working on that piece. Sessions
// answer through the API:
//   GET  /api/notes?key=<checkout>/<piece>                 → [{ id, t, fmt, file, text, status, reply, … }]
//   POST /api/notes          { key, t, fmt, file, text }   → a new note (status "open")
//   POST /api/notes/update   { key, id, status, reply, session }   status: open · sent · doing · done
//
// Looks (engine/looks/looks.js) restyle a finished render: POST /api/render with { look } runs engine/look.mjs
// on each chosen format's MP4 (→ <render>-<look>.mp4), and POST /api/look-still renders one frame for a preview.
// Studio jobs run under the machine-wide render lock (<state>/render.lock), like the agents' batches.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync, spawnSync } from 'node:child_process';
import FFMPEG from 'ffmpeg-static';
import { APP, HOME, STATE, projects, resolveIn, engineScript } from './paths.mjs';
import { createRequire } from 'node:module';
import { createPersona } from '../kit/persona.mjs';

const ROOT = APP;
const PORT = Number(process.env.PORT || 4173);
// ---- the Director: the kit's persona, briefed with director/DIRECTOR.md, working in ~/Studio ----------------
// Every node it (or a worker it starts) runs gets the engine overlay (overlay.mjs), and ffmpeg is the app's own.
const nodeOptions = () => [process.env.NODE_OPTIONS, `--import=${new URL('./overlay.mjs', import.meta.url).href}`].filter(Boolean).join(' ');
const ffmpegPath = () => { try { return process.env.FFMPEG || createRequire(import.meta.url)('ffmpeg-static'); } catch { return 'ffmpeg'; } };
const URL_SELF = `http://127.0.0.1:${PORT}`;
const director = createPersona({
  name: 'Director',
  dir: path.join(STATE, 'director'),
  cwd: HOME,
  brief: () => {
    let text = '';
    try { text = fs.readFileSync(path.join(APP, 'director', 'DIRECTOR.md'), 'utf8'); } catch {}
    return text.replaceAll('{{APP}}', APP).replaceAll('{{HOME}}', HOME).replaceAll('{{STATE}}', STATE).replaceAll('{{URL}}', URL_SELF);
  },
  env: () => ({ STUDIO_APP: APP, STUDIO_HOME: HOME, STUDIO_STATE: STATE, STUDIO_URL: URL_SELF, NODE_OPTIONS: nodeOptions(), FFMPEG: ffmpegPath() }),
  models: { claude: process.env.STUDIO_DIRECTOR_MODEL, codex: process.env.STUDIO_CODEX_MODEL },
  // what you were looking at, so "make this bigger" needs no explanation
  describe(c) {
    const piece = c.key && compositions().find(x => x.key === c.key);
    if (!piece) return '';
    const bits = [`piece ${piece.key} (“${piece.title}”)`, `folder ${path.join(rootOf(piece.checkout), 'videos', piece.id)}`];
    if (c.fmt) bits.push(`format ${c.fmt}${c.variant ? `, variant ${c.variant}` : ''}`);
    if (c.t != null) bits.push(`at ${Number(c.t).toFixed(2)} s`);
    bits.push(c.file ? `viewing the render ${c.file}` : 'viewing the live preview');
    return `[Studio: the user is looking at ${bits.join('; ')}.]`;
  },
  eventPrompt: details => `[Studio: you supervise the render queue. ${details.length > 1 ? 'These renders ended' : 'A render ended'}:\n` +
    details.map(d => `- ${d}`).join('\n') +
    `\nQA what finished (frames, loudness, loops), fix and requeue what failed, and tell the user in a line or two what is ready to review. ` +
    `If nothing needs doing, say so in one line.]`,
});
const FORMATS = ['16x9', '9x16', '1x1', '4x5'];
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.wav': 'audio/wav', '.bin': 'application/octet-stream' };

// ---- checkouts ------------------------------------------------------------------------------------
const git = (cwd, ...a) => { try { return execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }); } catch { return ''; } };

// [{ name, root, branch, main, project, base }]: per project, its main checkout first, then every worktree that
// still exists. A main checkout is named after its project; a worktree is <project>~<folder>.
function checkouts() {
  const out = [];
  for (const pr of projects()) {
    const list = [];
    let cur = null;
    for (const line of git(pr.root, 'worktree', 'list', '--porcelain').split('\n')) {
      if (line.startsWith('worktree ')) list.push(cur = { root: line.slice(9), branch: '' });
      else if (line.startsWith('branch ') && cur) cur.branch = line.slice(7).replace('refs/heads/', '');
    }
    if (!list.length) list.push({ root: pr.root, branch: '' });
    const base = list[0].branch || 'main';
    list.filter(c => fs.existsSync(path.join(c.root, 'videos'))).forEach((c, i) => out.push({
      ...c, main: i === 0, project: pr.name, base, name: i === 0 ? pr.name : `${pr.name}~${path.basename(c.root)}`,
    }));
  }
  return out;
}

// ---- looks ------------------------------------------------------------------------------------------
let LOOKS = {};
import(path.join(ROOT, 'engine', 'looks', 'looks.js')).then(m => { LOOKS = m.LOOKS; }).catch(e => console.error('studio: no looks', e.message));
const lookList = () => Object.entries(LOOKS).map(([name, l]) => ({ name, label: l.label, about: l.about }));
// The MP4 a look starts from: the piece's render for that format and variant. Older pieces name renders
// their own way (the first variant without a suffix, a 16:9 reel with no format in the name), so fall back
// step by step, never picking a look's own output.
const FMT_RE = /-(16x9|9x16|1x1|4x5)(?=[-.])/;
function renderFor(c, fmt, variant) {
  const name = c.name || c.id;
  const mp4s = c.renders.filter(r => r.file.endsWith('.mp4') && !Object.keys(LOOKS).some(l => r.file.endsWith(`-${l}.mp4`)));
  const exact = f => mp4s.find(r => r.file === f);
  const pick = list => list.sort((a, b) => (b.file.includes('music-only') - a.file.includes('music-only')) || a.file.length - b.file.length)[0];
  return exact(`${name}-${fmt}${variant ? '-' + variant : ''}.mp4`)
    || (variant === (c.variants || [''])[0] && exact(`${name}-${fmt}.mp4`))
    || pick(mp4s.filter(r => r.file.includes(`-${fmt}`) && (!variant || r.file.includes(variant))))
    || pick(mp4s.filter(r => r.file.includes(`-${fmt}`)))
    || (fmt === '16x9' && pick(mp4s.filter(r => !FMT_RE.test(r.file))))
    || null;
}

// ---- thumbnails: one frame per piece for the sidebar --------------------------------------------------
// From its 16:9 render (else its first format's), about 45% of the way in; a piece with no render yet shows
// its newest stills PNG. Cached in <main>/.studio/thumbs by source and mtime.
function newestStill(dir) {
  let best = null;
  const walk = d => { let es = []; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (e.name.endsWith('.png')) { const st = stat(f); if (st && (!best || st.mtimeMs > best.mtime)) best = { file: f, mtime: st.mtimeMs }; } } };
  walk(dir);
  return best;
}
function thumbSource(c) {
  const root = rootOf(c.checkout), dir = path.join(root, 'videos', c.id);
  const fmt = (c.formats || []).includes('16x9') ? '16x9' : (c.formats || [])[0];
  const r = fmt && renderFor(c, fmt, (c.variants || [''])[0]);
  if (r) return { file: path.join(dir, 'renders', r.file), mtime: r.mtime, video: true, t: (c.duration || 10) * 0.45 };
  const st = newestStill(path.join(dir, 'stills'));
  return st ? { ...st, video: false } : null;
}
function serveThumb(req, res, url) {
  const c = compositions().find(x => x.key === url.searchParams.get('key'));
  const src = c && thumbSource(c);
  if (!src) return send(res, 404, 'no thumbnail', 'text/plain');
  const dir = path.join(STATE, 'thumbs'); fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, `${c.key.replace(/[^\w-]+/g, '_')}-${Math.round(src.mtime)}.jpg`);
  const done = () => { res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'max-age=86400' }); fs.createReadStream(out).pipe(res); };
  if (fs.existsSync(out)) return done();
  const a = ['-hide_banner', '-loglevel', 'error', '-y', ...(src.video ? ['-ss', String(src.t)] : []), '-i', src.file, '-frames:v', '1', '-vf', 'scale=240:-2', '-q:v', '4', out];
  const p = spawn(FFMPEG, a);
  p.on('close', code => (code === 0 && fs.existsSync(out) ? done() : send(res, 500, 'thumbnail failed', 'text/plain')));
}

// ---- notes ------------------------------------------------------------------------------------------
const notesDir = () => path.join(STATE, 'notes');
const notesFile = key => path.join(notesDir(), key.replace('/', '__').replace(/[^\w.-]/g, '_') + '.json');
function readNotes(key) { try { return JSON.parse(fs.readFileSync(notesFile(key), 'utf8')); } catch { return []; } }
function writeNotes(key, list) {
  fs.mkdirSync(notesDir(), { recursive: true });
  const f = notesFile(key), tmp = f + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2)); fs.renameSync(tmp, f);    // never a half-written file
}
const sessionOf = root => { try { return fs.readFileSync(path.join(root, '.cube-session'), 'utf8').trim().split('\n')[0] || null; } catch { return null; } };

// Piece ids this checkout's branch changes relative to main, committed or not.
function touched(co) {
  if (co.main) return new Set();
  const ids = new Set();
  const add = out => out.split('\n').forEach(f => { const m = /^(?:.. )?videos\/([^/]+)\//.exec(f.trim()); if (m) ids.add(m[1]); });
  add(git(co.root, 'diff', '--name-only', `${co.base}...HEAD`, '--', 'videos'));
  add(git(co.root, 'status', '--porcelain', '--', 'videos').split('\n').map(l => l.slice(3)).join('\n'));
  return ids;
}

// ---- what's rendering right now ---------------------------------------------------------------------
// [{ pid, args, cwd }] for the render, encode and ffmpeg processes on the machine.
function renderProcs() {
  const out = [];
  if (process.platform !== 'linux') return out;
  for (const pid of fs.readdirSync('/proc').filter(d => /^\d+$/.test(d))) {
    let args = '';
    try { args = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').join(' ').trim(); } catch { continue; }
    if (!/engine\/(render|encode|batch)\.mjs|ffmpeg/.test(args)) continue;
    let cwd = '';
    try { cwd = fs.readlinkSync(`/proc/${pid}/cwd`); } catch {}
    out.push({ pid: Number(pid), args, cwd });
  }
  return out;
}
const countPngs = dir => { try { return fs.readdirSync(dir).filter(f => f.endsWith('.png')).length; } catch { return 0; } };

// ---- status -----------------------------------------------------------------------------------------
const stat = f => { try { return fs.statSync(f); } catch { return null; } };   // files come and go while agents render
// Times come from git where it knows them: a committed, unchanged file dates from its last commit (a checkout
// or a merge resets mtimes, so those can't be trusted); an edited or untracked file dates from its mtime.
const CODE = /\.(js|mjs|html|css|json)$/;
function gitTimes(root, id) {
  const rel = `videos/${id}`;
  const dirty = new Set(git(root, 'status', '--porcelain', '--untracked-files=all', '--', rel).split('\n').filter(Boolean).map(l => l.slice(3).trim()));
  const committed = f => Number(git(root, 'log', '-1', '--format=%ct', '--', f).trim()) * 1000 || 0;
  const timeOf = f => {                                // f relative to the checkout
    if (dirty.has(f)) { const st = stat(path.join(root, f)); return st ? st.mtimeMs : 0; }
    return committed(f) || (stat(path.join(root, f))?.mtimeMs ?? 0);
  };
  // code: the last commit touching it outside renders/, or any edited code file, whichever is newer
  // comp.json is left out: renaming a piece (its title) shouldn't make its renders look stale
  let code = Number(git(root, 'log', '-1', '--format=%ct', '--', rel, `:(exclude)${rel}/renders`, `:(exclude)${rel}/*.md`, `:(exclude)${rel}/comp.json`).trim()) * 1000 || 0;
  for (const f of dirty) if (CODE.test(f) && !f.endsWith('/comp.json') && !f.includes('/renders/') && !f.includes('/stills/')) { const st = stat(path.join(root, f)); if (st) code = Math.max(code, st.mtimeMs); }
  return { code, timeOf };
}
const ago = ms => { const m = Math.round((Date.now() - ms) / 60000); return m < 60 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`; };
const FMT_LABEL = { '16x9': '16:9', '9x16': '9:16', '1x1': '1:1', '4x5': '4:5' };

function piece(co, id, procs, failed) {
  const dir = path.join(co.root, 'videos', id);
  let m;
  try { m = JSON.parse(fs.readFileSync(path.join(dir, 'comp.json'), 'utf8')); } catch (e) { console.error(`studio: skipping ${co.name}/${id}: ${e.message}`); return null; }
  const base = `/wt/${co.name}/videos/${id}`;
  const rdir = path.join(dir, 'renders');
  const renders = (fs.existsSync(rdir) ? fs.readdirSync(rdir) : []).filter(f => /\.(mp4|jpg|png)$/.test(f)).sort()
    .map(f => [f, stat(path.join(rdir, f))]).filter(([, st]) => st).map(([f, st]) => ({ file: f, url: `${base}/renders/${f}`, size: st.size, mtime: st.mtimeMs }));
  // preview sound: the raw soundtrack if it has been generated (gain applied in the player), else the reference render
  const wav = m.soundtrack && fs.existsSync(path.join(dir, m.soundtrack.wav));
  const ref = m.audio && fs.existsSync(path.join(dir, m.audio));
  const audioUrl = wav ? `${base}/${m.soundtrack.wav}` : ref ? `${base}/${m.audio}` : null;

  // processes working on this piece: anything naming its folder, by absolute path or relative to the checkout
  // the folder name must end where the path does: cube-island must not match cube-island-studio
  const esc = x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const named = new RegExp(`${esc(dir)}(?=[\\s/]|$)`), rel = new RegExp(`(^|[\\s=])videos/${esc(id)}(?=[\\s/]|$)`);
  const mine = procs.filter(p => named.test(p.args) || (p.cwd === co.root && rel.test(p.args)));
  const total = Math.round((m.duration || 0) * (m.fps || 60));
  const rendering = mine.filter(p => / seq /.test(p.args)).map(p => {
    const fmt = /--fmt (\S+)/.exec(p.args)?.[1] || '16x9', d = /--dir (\S+)/.exec(p.args)?.[1];
    return { fmt, label: FMT_LABEL[fmt] || fmt, done: d ? countPngs(d) : 0, total };
  });
  const encoding = mine.filter(p => /encode\.mjs/.test(p.args)).map(p => path.basename(/--out (\S+)/.exec(p.args)?.[1] || ''));
  const stills = mine.some(p => / stills /.test(p.args));

  // a ticket waiting in the render queue for this checkout's piece
  const ticket = (compositions.tickets || []).find(t => t.piece === id && t.cwd && (t.cwd === co.root || t.cwd.startsWith(co.root + '/')));
  const name = m.name || id;
  const mp4s = renders.filter(r => r.file.endsWith('.mp4'));
  const gt = gitTimes(co.root, id), src = gt.code;
  const newest = Math.max(0, ...mp4s.map(r => gt.timeOf(`videos/${id}/renders/${r.file}`)));
  const notes = [];
  let status;
  if (ticket && ticket.status !== 'running') status = 'queued';
  else if (rendering.length || encoding.length || mine.some(p => /batch\.mjs/.test(p.args) && !/queue\.mjs/.test(p.args))) status = 'rendering';
  else {
    const missing = (m.formats || []).filter(f => !mp4s.some(r => r.file.startsWith(`${name}-${f}`)));
    if (failed) notes.push('Last Studio render failed');
    if (mp4s.length && src > newest + 60000) notes.push(`Code changed ${ago(src)}; renders are from ${ago(newest)}`);
    if (mp4s.length && missing.length) notes.push(`No render yet for ${missing.map(f => FMT_LABEL[f]).join(', ')}`);
    status = notes.length ? 'attention' : mp4s.length ? 'ready' : 'cooking';
    if (status === 'ready') notes.push(`Rendered ${ago(newest)}`);
    if (status === 'ready' && co.main) status = 'main';     // rendered, current, and on the project's main branch: done
    if (status === 'cooking') notes.push(stills ? 'Checking stills' : `Last change ${ago(src)}`);
  }
  if (status === 'queued') notes.push(`In the render queue · #${ticket.position}`);
  if (status === 'rendering') {
    rendering.forEach(r => notes.push(`${r.label} ${r.done}/${r.total}`));
    encoding.forEach(f => notes.push(`Encoding ${f}`));
  }
  const last = git(co.root, 'log', '-1', '--format=%s', '--', `videos/${id}`).trim();
  const notesList = readNotes(`${co.name}/${id}`);
  return {
    session: co.main ? null : sessionOf(co.root), openNotes: notesList.filter(n => n.status !== 'done').length,
    key: `${co.name}/${id}`, id, checkout: co.name, branch: co.branch, ...m,
    url: `${base}/${m.page || 'index.html'}`, renders, audioUrl, audioGain: wav ? m.soundtrack.gain ?? 0 : 0,
    status, notes, rendering, lastCommit: last, changed: src,
  };
}

// Every piece on main, plus each worktree's version of the pieces its branch changes.
let cache = { at: 0, list: [] };
function compositions() {
  if (Date.now() - cache.at < 1500) return cache.list;
  const cos = checkouts(), procs = renderProcs();
  compositions.tickets = queueTickets();
  const owners = new Map();                          // id → [checkouts that change it]
  for (const co of cos.filter(c => !c.main)) for (const id of touched(co)) {
    if (fs.existsSync(path.join(co.root, 'videos', id, 'comp.json'))) owners.set(id, [...(owners.get(id) || []), co]);
  }
  const list = [];
  for (const [id, list2] of owners) for (const co of list2) list.push(piece(co, id, procs, failedKeys.has(`${co.name}/${id}`)));
  for (const main of cos.filter(c => c.main)) for (const id of fs.readdirSync(path.join(main.root, 'videos'))) {
    if (!fs.existsSync(path.join(main.root, 'videos', id, 'comp.json'))) continue;
    if (owners.get(id)?.some(co => co.project === main.project)) continue;   // listed from the worktree changing it
    list.push(piece(main, id, procs, failedKeys.has(`${main.name}/${id}`)));
  }
  cache.roots = new Map(cos.map(c => [c.name, c.root]));
  for (const c of list.filter(Boolean)) { const src = thumbSource(c); c.thumb = src ? `/api/thumb?key=${encodeURIComponent(c.key)}&v=${Math.round(src.mtime)}` : null; }
  // pipeline order: what needs you, then what's being made, then what's ready, then what's shipped
  const ORDER = { attention: 0, cooking: 1, queued: 2, rendering: 3, ready: 4, main: 5 };
  cache = { at: Date.now(), list: list.filter(Boolean).sort((a, b) => ORDER[a.status] - ORDER[b.status] || b.changed - a.changed) };
  cache.roots = new Map(cos.map(c => [c.name, c.root]));
  return cache.list;
}
const rootOf = name => { if (!cache.roots) compositions(); return cache.roots.get(name) || (cache.at = 0, compositions(), cache.roots.get(name)); };

// render jobs run one at a time through engine/batch.mjs
const jobs = [];
const failedKeys = new Set();
let running = null;
function pump() {
  if (running) return;
  const job = jobs.find(j => j.status === 'queued');
  if (!job) return;
  running = job; job.status = 'running'; job.started = Date.now();
  const comp = compositions().find(c => c.key === job.comp);
  const fail = msg => { if (msg) job.log += `\n${msg}`; job.status = 'failed'; job.ended = Date.now(); running = null; failedKeys.add(job.comp); cache.at = 0; pump(); };
  if (!comp) return fail(`composition ${job.comp} not found`);
  failedKeys.delete(job.comp);
  const root = rootOf(comp.checkout);                 // render with the piece's own checkout and engine
  const cdir = path.join(root, 'videos', comp.id);
  const steps = [];
  if (job.look) {
    for (const j of job.jobs) {
      const r = renderFor(comp, j.fmt, j.variant);
      if (!r) return fail(`no ${j.fmt}${j.variant ? ' ' + j.variant : ''} render to apply the look to; render it first`);
      steps.push([path.join(APP, 'engine', 'look.mjs'), [path.join(cdir, 'renders', r.file), '--look', job.look, '--parallel', '2']]);
    }
    return runSteps(job, steps, root);
  }
  if (comp.soundtrack) steps.push([path.join(cdir, comp.soundtrack.script), [path.join(cdir, comp.soundtrack.wav)], comp.soundtrack.env]);
  const batchArgs = [engineScript(root, 'batch.mjs'), cdir, '--jobs', job.jobs.map(j => `${j.fmt}:${j.variant}`).join(','), '--name', comp.name || comp.id, '--parallel', '2', '--mb', '8'];
  if (comp.soundtrack) batchArgs.push('--audio', path.join(cdir, comp.soundtrack.wav), '--gain', String(comp.soundtrack.gain ?? 0));
  steps.push([batchArgs[0], batchArgs.slice(1)]);
  runSteps(job, steps, root);
}
const LOCK = () => path.join(STATE, 'render.lock');
// ---- the render queue (engine/queue.mjs): tickets in <state>/queue, your order in <state>/queue-order.json ----
const QDIR = () => path.join(STATE, 'queue'), QORDER = () => path.join(STATE, 'queue-order.json');
const pidAlive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
function queueOrder() { try { const o = JSON.parse(fs.readFileSync(QORDER(), 'utf8')); return Array.isArray(o) ? o : []; } catch { return []; } }
function setQueueOrder(o) { fs.mkdirSync(path.dirname(QORDER()), { recursive: true }); const tmp = QORDER() + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(o)); fs.renameSync(tmp, QORDER()); }
// running first, then waiting in the order queue.mjs will run them
function queueTickets() {
  let files = []; try { files = fs.readdirSync(QDIR()).filter(f => f.endsWith('.json')); } catch {}
  const list = files.map(f => { try { return JSON.parse(fs.readFileSync(path.join(QDIR(), f), 'utf8')); } catch { return null; } }).filter(t => t && pidAlive(t.pid));
  const o = queueOrder(), rank = t => { const i = o.indexOf(t.piece); return i < 0 ? Infinity : i; };
  const run = list.filter(t => t.status === 'running');
  const wait = list.filter(t => t.status !== 'running').sort((a, b) => rank(a) - rank(b) || a.queued - b.queued);
  return [...run, ...wait.map((t, i) => ({ ...t, position: i + 1 }))];
}
const procs = new Map();                              // job id → the process running its current step
function runSteps(job, steps, root) {
  const fail = msg => { if (job.status === 'cancelled') return; if (msg) job.log += `\n${msg}`; job.status = 'failed'; job.ended = Date.now(); running = null; failedKeys.add(job.comp); cache.at = 0; pump(); };
  fs.mkdirSync(path.dirname(LOCK()), { recursive: true });
  const next = () => {
    const s = steps.shift();
    if (job.status === 'cancelled') return;
    if (!s) { job.status = 'done'; job.ended = Date.now(); running = null; cache.at = 0; pump(); return; }
    // queue behind any other render on the machine (agents' batches take the same lock)
    // own process group, so cancelling stops flock and the render under it
    const p = spawn(process.execPath, [path.join(ROOT, 'engine', 'queue.mjs'), '--piece', job.comp.split('/').pop(), '--', process.execPath, s[0], ...s[1]], { cwd: root, env: { ...process.env, NODE_OPTIONS: nodeOptions(), ...s[2] }, detached: true });
    procs.set(job.id, p);
    job.status = 'waiting';                             // until the lock is ours and the step speaks
    const log = d => { const t = String(d); if (job.status === 'waiting' && !/^queue: .* is #\d/m.test(t)) job.status = 'running'; job.log = (job.log + t).slice(-4000); };
    let settled = false;
    p.stdout.on('data', log); p.stderr.on('data', log);
    p.on('error', e => { if (!settled) { settled = true; fail(String(e)); } });
    p.on('close', code => { procs.delete(job.id); if (settled) return; settled = true; if (code !== 0) fail(); else next(); });
  };
  next();
}

const send = (res, code, body, type = 'application/json') => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' }); res.end(typeof body === 'string' ? body : JSON.stringify(body)); };

// One "bytes=a-b" range → [start, end]; null when it can't be satisfied (416); undefined to ignore the header.
// Players ask for ranges past the end when a render they had loaded was re-encoded smaller.
function byteRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!m || (m[1] === '' && m[2] === '')) return undefined;
  const start = m[1] === '' ? Math.max(0, size - Number(m[2])) : Number(m[1]);
  const end = m[1] === '' || m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  return start <= end ? [start, end] : null;
}

const LABELS = { '16x9': '16:9', '9x16': '9:16', '1x1': '1:1', '4x5': '4:5' };
function serveLookStill(req, res, url, p) {
  const f = path.join(STATE, 'looks', path.basename(p));
  if (!fs.existsSync(f)) return send(res, 404, 'not found', 'text/plain');
  res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' });
  fs.createReadStream(f).pipe(res);
}

// A checkout's page and scripts ask for /engine/…, /brand/… and /videos/… by absolute path; under
// /wt/<name>/ those become /wt/<name>/… so the whole page loads from that checkout.
const REWRITE = /\.(html|js|mjs|css)$/;
const rewrite = (text, name) => text.replace(/(["'`(])\/(engine|brand|videos)\//g, `$1/wt/${name}/$2/`);
// Pages under /wt/ get a reporter first in <head>: any error in the preview reaches the Studio, which shows
// it and logs it to <main>/.studio/client-errors.log, so a browser-only failure can be read from the shell.
const REPORTER = `<script>(function(){var s=function(m){try{parent.postMessage({previewError:String(m).slice(0,2000)},'*')}catch(_){}};
addEventListener('error',function(e){s((e.error&&e.error.stack)||e.message+' at '+e.filename+':'+e.lineno+':'+e.colno)},true);
addEventListener('unhandledrejection',function(e){var r=e.reason;s('unhandled rejection: '+((r&&r.stack)||r))});})();</script>`;
const inject = html => (/<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, m => m + REPORTER) : REPORTER + html);

// The Studio's own page and assets come from the app; /wt/<checkout>/… from that checkout, with the app's
// engine/, brand/ and node_modules/ behind the checkout's own (resolveIn).
const APP_PATHS = /^\/(studio|brand|engine|kit|node_modules)\//;
function serveFile(req, res, url, p) {
  let root = APP, rel = p === '/' ? '/studio/index.html' : p, wt = null, file = null;
  const m = /^\/wt\/([^/]+)(\/.*)$/.exec(p);
  if (m) {
    wt = m[1]; root = rootOf(wt); rel = m[2];
    if (!root) return send(res, 404, 'no such checkout', 'text/plain');
    file = resolveIn(root, rel);
  } else if (APP_PATHS.test(rel) || rel === '/studio/index.html') {
    const f = path.join(APP, rel);
    if (f.startsWith(APP + path.sep)) file = f;
  }
  let st = null;
  if (file) try { st = fs.statSync(file); } catch {}
  if (!st || st.isDirectory()) return send(res, 404, 'not found', 'text/plain');
  if (wt && REWRITE.test(file)) {
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch { return send(res, 404, 'not found', 'text/plain'); }
    const out = rewrite(text, wt);
    return send(res, 200, path.extname(file) === '.html' ? inject(out) : out, TYPES[path.extname(file)]);
  }
  const size = st.size;
  const headers = { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'accept-ranges': 'bytes', 'cache-control': 'no-store' };
  if (url.searchParams.has('download')) headers['content-disposition'] = `attachment; filename="${path.basename(file)}"`;
  const range = req.headers.range ? byteRange(req.headers.range, size) : undefined;
  if (range === null) { res.writeHead(416, { ...headers, 'content-range': `bytes */${size}` }); return res.end(); }
  if (range) headers['content-range'] = `bytes ${range[0]}-${range[1]}/${size}`;
  res.writeHead(range ? 206 : 200, { ...headers, 'content-length': range ? range[1] - range[0] + 1 : size });
  if (req.method === 'HEAD') return res.end();
  const stream = fs.createReadStream(file, range ? { start: range[0], end: range[1] } : {});
  stream.on('error', () => res.destroy());           // e.g. the file was replaced mid-read by a new render
  stream.pipe(res);
}

http.createServer((req, res) => {
  try { route(req, res); } catch (e) {
    console.error('studio:', e);
    if (!res.headersSent) send(res, 500, { error: String(e) }); else res.destroy();
  }
}).listen(PORT, '127.0.0.1', () => console.log(`Cube Studio → http://127.0.0.1:${PORT}`));

// last line of defence: a dev server should log and keep serving rather than exit
process.on('uncaughtException', e => console.error('studio: uncaught', e));
// ---- the Director supervises the render queue ---------------------------------------------------------
// Every ticket queue.mjs runs (the Studio's renders and the agents' batches alike, in any project) ends with a
// line in <state>/queue-history.jsonl. Each batch or look that ends goes to the Director as an event, with what
// it wrote, so one Director can QA everything without anyone asking.
const HISTORY = path.join(STATE, 'queue-history.jsonl');
let historyAt = (() => { try { return fs.statSync(HISTORY).size; } catch { return 0; } })();
function renderEnded(t) {
  const m = /(?:^|\s)(\S*\/)?videos\/([^/\s]+)/.exec(t.cmd) || [];
  const id = t.piece !== 'unknown' ? t.piece : m[2];
  const root = (t.cwd && checkouts().find(co => t.cwd === co.root || t.cwd.startsWith(co.root + '/'))) || null;
  const where = root ? `${root.name}/${id}` : id;
  const kind = /look\.mjs/.test(t.cmd) ? 'look' : 'render';
  const outcome = t.how === 'cancelled' ? 'was cancelled' : t.code === 0 ? 'finished' : `failed (exit ${t.code})`;
  let wrote = [];
  if (root && t.code === 0) {
    const dir = path.join(root.root, 'videos', id, 'renders');
    try { wrote = fs.readdirSync(dir).filter(f => f.endsWith('.mp4') && (stat(path.join(dir, f))?.mtimeMs || 0) >= t.queued); } catch {}
  }
  const mins = Math.max(1, Math.round((t.ended - t.queued) / 60000));
  director.event(`${kind === 'look' ? 'Look' : 'Render'} ${outcome} · ${where}`,
    `${kind} of ${where} ${outcome} after ${mins} min${root ? ` (folder ${path.join(root.root, 'videos', id)})` : ''}` +
    `${wrote.length ? `; wrote ${wrote.join(', ')}` : ''}. Command: ${t.cmd}`);
}
fs.watchFile(HISTORY, { interval: 2000 }, cur => {
  if (cur.size < historyAt) historyAt = 0;            // rotated or cleared
  if (cur.size === historyAt) return;
  const fd = fs.openSync(HISTORY, 'r'), buf = Buffer.alloc(cur.size - historyAt);
  fs.readSync(fd, buf, 0, buf.length, historyAt); fs.closeSync(fd);
  const text = buf.toString('utf8'), end = text.lastIndexOf('\n') + 1;
  historyAt += Buffer.byteLength(text.slice(0, end));
  for (const line of text.slice(0, end).split('\n')) {
    if (!line) continue;
    let t; try { t = JSON.parse(line); } catch { continue; }
    if (/(batch|look)\.mjs/.test(t.cmd || '')) { cache.at = 0; renderEnded(t); }
  }
});

// Cube stops an app with SIGTERM: end the Director's running turn with it
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { director.shutdown(); process.exit(0); });

// Read a small JSON body, then hand it on; a bad one is a 400, not a crash.
function body(req, res, fn) {
  let raw = '';
  req.on('data', d => { raw += d; if (raw.length > 1e5) req.destroy(); });
  req.on('end', () => { let b; try { b = JSON.parse(raw || '{}'); } catch (e) { return send(res, 400, { error: String(e) }); } try { fn(b); } catch (e) { send(res, 500, { error: String(e) }); } });
}

function route(req, res) {
  const url = new URL(req.url, 'http://x');
  let p;
  try { p = decodeURIComponent(url.pathname); } catch { return send(res, 400, 'bad url', 'text/plain'); }
  if (p === '/api/compositions') return send(res, 200, compositions());
  if (director.route(req, res, p, '/api/director', { body, send })) return;
  if (p === '/api/studio') return send(res, 200, { home: HOME, state: STATE, app: APP, projects: projects(), director: director.status() });
  if (p === '/api/jobs') return send(res, 200, jobs.slice(-20).reverse());
  if (p === '/api/jobs/cancel' && req.method === 'POST') return body(req, res, b => {
    const job = jobs.find(j => j.id === Number(b.id));
    if (!job || !['queued', 'waiting', 'running'].includes(job.status)) return send(res, 400, { error: 'nothing to cancel' });
    const was = job.status;
    job.status = 'cancelled'; job.ended = Date.now();
    const pr = procs.get(job.id);
    if (pr) { try { process.kill(-pr.pid, 'SIGTERM'); } catch {} procs.delete(job.id); }
    if (was !== 'queued' && running === job) { running = null; pump(); }
    send(res, 200, job);
  });
  if (p === '/api/looks') return send(res, 200, lookList());
  if (p === '/api/queue' && req.method === 'GET') {
    const comps = compositions(), byId = id => comps.find(c => c.id === id && c.status !== 'main') || comps.find(c => c.id === id);
    const tickets = queueTickets().map(t => { const c = byId(t.piece); return { ...t, title: c ? c.title : t.piece, key: c ? c.key : null, progress: c && c.status === 'rendering' ? c.notes.join(' · ') : '' }; });
    const pinned = queueOrder().filter(id => !tickets.some(t => t.piece === id)).map(id => { const c = byId(id); return { piece: id, title: c ? c.title : id, key: c ? c.key : null }; });
    return send(res, 200, { tickets, pinned, order: queueOrder() });
  }
  if (p.startsWith('/api/queue/') && req.method === 'POST') return body(req, res, b => {
    let o = queueOrder();
    if (p === '/api/queue/order') { if (!Array.isArray(b.order)) return send(res, 400, { error: 'order must be a list' }); o = [...new Set(b.order.map(String))]; }
    else if (p === '/api/queue/next') { if (!b.piece) return send(res, 400, { error: 'piece?' }); o = [String(b.piece), ...o.filter(x => x !== String(b.piece))]; }
    else if (p === '/api/queue/unpin') o = o.filter(x => x !== String(b.piece));
    else if (p === '/api/queue/cancel') {
      const t = queueTickets().find(x => x.id === String(b.id));
      if (!t) return send(res, 404, { error: 'no such ticket' });
      try { process.kill(t.pid, 'SIGTERM'); } catch (e) { return send(res, 500, { error: String(e) }); }
      cache.at = 0; return send(res, 200, { ok: true });
    } else return send(res, 404, { error: 'unknown queue action' });
    setQueueOrder(o); cache.at = 0;
    send(res, 200, { order: o });
  });
  if (p === '/api/thumb') return serveThumb(req, res, url);
  if (p === '/api/look-still' && req.method === 'POST') return body(req, res, b => {
    const c = compositions().find(x => x.key === b.key);
    if (!c || !LOOKS[b.look]) return send(res, 400, { error: 'unknown piece or look' });
    const r = (b.file && c.renders.find(x => x.file === b.file && x.file.endsWith('.mp4'))) || renderFor(c, b.fmt, b.variant || '');
    if (!r) return send(res, 400, { error: `no ${LABELS[b.fmt] || b.fmt} render to preview the look on; render it first` });
    const t = Math.max(0, Number(b.t) || 0);
    const dir = path.join(STATE, 'looks'); fs.mkdirSync(dir, { recursive: true });
    const name = `${c.key.replace(/[^\w-]+/g, '_')}-${r.file.replace(/\.mp4$/, '')}-${b.look}-${t.toFixed(2)}.png`;
    const src = path.join(rootOf(c.checkout), 'videos', c.id, 'renders', r.file);
    const p2 = spawn(process.execPath, [path.join(ROOT, 'engine', 'look.mjs'), src, '--look', b.look, '--still', String(t), '--out', path.join(dir, name)]);
    let log = ''; p2.stdout.on('data', d => (log += d)); p2.stderr.on('data', d => (log += d));
    p2.on('close', code => code === 0 ? send(res, 200, { url: `/studio-looks/${encodeURIComponent(name)}`, file: r.file, t, look: b.look }) : send(res, 500, { error: log.slice(-600) }));
  });
  if (p.startsWith('/studio-looks/')) return serveLookStill(req, res, url, p);
  if (p === '/api/client-error' && req.method === 'POST') return body(req, res, b => {
    const line = JSON.stringify({ at: new Date().toISOString(), ua: String(req.headers['user-agent'] || ''), piece: String(b.piece || ''), fmt: String(b.fmt || ''), error: String(b.error || '').slice(0, 4000) });
    fs.mkdirSync(STATE, { recursive: true });
    fs.appendFileSync(path.join(STATE, 'client-errors.log'), line + '\n');
    send(res, 200, { ok: true });
  });
  if (p === '/api/notes' && req.method === 'GET') return send(res, 200, readNotes(url.searchParams.get('key') || ''));
  if ((p === '/api/notes' || p === '/api/notes/update') && req.method === 'POST') return body(req, res, b => {
    const c = compositions().find(x => x.key === b.key);
    if (!c) return send(res, 400, { error: 'unknown piece' });
    const list = readNotes(c.key);
    if (p === '/api/notes') {
      const text = String(b.text || '').trim().slice(0, 4000);
      if (!text) return send(res, 400, { error: 'empty note' });
      // the same note twice within a few seconds is a double submit, not a second note
      const twin = list.find(x => x.text === text && Date.now() - x.created < 15000);
      if (twin) return send(res, 200, twin);
      const n = { id: Math.max(0, ...list.map(x => x.id)) + 1, t: Math.max(0, Number(b.t) || 0), fmt: String(b.fmt || ''), file: b.file ? String(b.file) : null,
        text, status: 'open', created: Date.now(), session: c.session || null, reply: '' };
      list.push(n); writeNotes(c.key, list); cache.at = 0;
      const root = rootOf(c.checkout);
      const ev = { ...n, key: c.key, title: c.title, checkout: c.checkout, branch: c.branch, root, piece: path.join(root, 'videos', c.id) };
      fs.appendFileSync(path.join(STATE, 'inbox.jsonl'), JSON.stringify(ev) + '\n');
      const where = `${ev.key}${ev.fmt ? ` (${ev.fmt})` : ''} at ${Number(ev.t || 0).toFixed(2)} s`;
      director.inject(ev.text,
        `[Studio: the user pinned note #${ev.id} on ${where}${ev.file ? `, on the render ${ev.file}` : ''}. Piece folder: ${ev.piece}. ` +
        `Act on it, or hand it to whoever is working on that piece, and mark it with POST /api/notes/update (key "${ev.key}", id ${ev.id}).]\n\n${ev.text}`,
        { context: { label: `Note · ${ev.title} · ${Number(ev.t || 0).toFixed(2)} s`, ref: { key: ev.key, t: ev.t, fmt: ev.fmt }, pin: true } });
      return send(res, 200, n);
    }
    const n = list.find(x => x.id === Number(b.id));
    if (!n) return send(res, 404, { error: 'no such note' });
    if (b.status) { if (!['open', 'sent', 'doing', 'done'].includes(b.status)) return send(res, 400, { error: 'bad status' }); n.status = b.status; }
    if (b.reply != null) n.reply = String(b.reply).slice(0, 4000);
    if (b.session) n.session = String(b.session).slice(0, 120);
    if (b.text != null && String(b.text).trim()) n.text = String(b.text).trim().slice(0, 4000);
    if (b.delete) list.splice(list.indexOf(n), 1);
    n.updated = Date.now(); writeNotes(c.key, list); cache.at = 0;
    return send(res, 200, n);
  });
  if (p === '/api/render' && req.method === 'POST') {
    let body = '';
    req.on('data', d => (body += d));
    req.on('end', () => {
      try {
        const { comp, jobs: list, look } = JSON.parse(body);
        if (look && !LOOKS[look]) return send(res, 400, { error: 'unknown look' });
        const c = compositions().find(x => x.key === comp);
        const ok = c && Array.isArray(list) && list.length && list.every(j => FORMATS.includes(j.fmt) && c.formats.includes(j.fmt) && c.variants.includes(j.variant ?? ''));
        if (!ok) return send(res, 400, { error: 'unknown composition, format or variant' });
        const sig = j => JSON.stringify([j.comp, j.look || null, j.jobs]);
        const want = { comp, look: look || null, jobs: list.map(j => ({ fmt: j.fmt, variant: j.variant ?? '' })) };
        const same = jobs.find(j => ['queued', 'waiting', 'running'].includes(j.status) && sig(j) === sig(want));
        if (same) return send(res, 200, { ...same, duplicate: true });   // already on its way: don't queue it twice
        const job = { id: jobs.length + 1, comp, look: look || null, jobs: list.map(j => ({ fmt: j.fmt, variant: j.variant ?? '' })), status: 'queued', log: '', queued: Date.now() };
        jobs.push(job); pump();
        send(res, 200, job);
      } catch (e) { send(res, 400, { error: String(e) }); }
    });
    return;
  }
  // static files from the repo (studio at /)
  serveFile(req, res, url, p);
}
