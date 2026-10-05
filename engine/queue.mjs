#!/usr/bin/env node
// The render queue: runs a heavy command (a batch, a look) one at a time across the whole machine, in
// your priority order instead of whoever grabs the lock first.
//
//   node <app>/engine/queue.mjs [--piece <folder id>] -- node <app>/engine/batch.mjs videos/<piece> --jobs …
//
// Each call files a ticket in <state>/queue/ (the Studio's state folder, see paths.mjs). Waiting tickets run in
// the order of <state>/queue-order.json (a list of piece folder ids, set from the Studio), then first come,
// first served. One ticket runs at a time; it still takes <state>/render.lock, so anything using the
// raw lock queues behind it too. Output passes through, the exit code is the command's, and stopping this
// process (Ctrl-C, SIGTERM, or ✕ in the Studio) stops the command and removes the ticket.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { STATE } from './paths.mjs';

const args = process.argv.slice(2);
const dd = args.indexOf('--');
if (dd < 0 || dd === args.length - 1) { console.error('usage: queue.mjs [--piece <id>] -- <command …>'); process.exit(2); }
const head = args.slice(0, dd), cmd = args.slice(dd + 1);
const pieceOpt = head.includes('--piece') ? head[head.indexOf('--piece') + 1] : null;
const piece = pieceOpt || (/videos\/([^/\s]+)/.exec(cmd.join(' ')) || [])[1] || 'unknown';

// one queue for the whole machine, whichever project or worktree the command runs in
const Q = path.join(STATE, 'queue'), ORDER = path.join(STATE, 'queue-order.json');
const LOCK = path.join(STATE, 'render.lock'), HISTORY = path.join(STATE, 'queue-history.jsonl');
fs.mkdirSync(Q, { recursive: true });

const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
function tickets() {
  const out = [];
  for (const f of fs.readdirSync(Q).filter(f => f.endsWith('.json'))) {
    const t = readJson(path.join(Q, f), null);
    if (!t) continue;
    if (!alive(t.pid)) { fs.rmSync(path.join(Q, f), { force: true }); continue; }   // its owner died: drop it
    out.push(t);
  }
  return out;
}
const order = () => { const o = readJson(ORDER, []); return Array.isArray(o) ? o : []; };
const rank = (t, o) => { const i = o.indexOf(t.piece); return i < 0 ? Infinity : i; };
export const sortWaiting = (list, o) => list.filter(t => t.status === 'waiting').sort((a, b) => rank(a, o) - rank(b, o) || a.queued - b.queued);

const id = `${Date.now()}-${process.pid}`;
const file = path.join(Q, `${id}.json`);
const ticket = { id, piece, cmd: cmd.join(' '), cwd: process.cwd(), pid: process.pid, queued: Date.now(), status: 'waiting' };
const save = () => { const tmp = file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(ticket)); fs.renameSync(tmp, file); };
save();

let child = null, done = false;
function finish(code, how) {
  if (done) return; done = true;
  fs.rmSync(file, { force: true });
  try { fs.appendFileSync(HISTORY, JSON.stringify({ ...ticket, ended: Date.now(), how, code }) + '\n'); } catch {}
  process.exit(code);
}
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => {
  if (child) { try { process.kill(-child.pid, 'SIGTERM'); } catch {} }
  finish(130, 'cancelled');
});

let announced = -1;
(function wait() {
  const all = tickets(), o = order();
  const running = all.find(t => t.status === 'running' && t.id !== id);
  const waiting = sortWaiting(all, o);
  const pos = waiting.findIndex(t => t.id === id);
  if (pos !== announced) { announced = pos; console.log(`queue: ${piece} is #${pos + 1} in the render queue${running ? ` (rendering: ${running.piece})` : ''}`); }
  if (running || pos !== 0) return setTimeout(wait, 2000);
  ticket.status = 'running'; ticket.started = Date.now(); save();
  console.log(`queue: ${piece} starts`);
  // flock keeps anything still using the raw lock out of the way; detached so ✕ can stop the whole group
  child = spawn('flock', [LOCK, ...cmd], { stdio: 'inherit', detached: true });
  child.on('exit', code => finish(code ?? 1, 'done'));
  child.on('error', e => { console.error('queue:', e.message); finish(1, 'failed'); });
})();
