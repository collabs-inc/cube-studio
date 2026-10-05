// The Director: one long-running conversation with a coding agent that runs the Studio for you. It lives in the
// Studio's left column. Each message you send (and each note you pin) becomes one turn of Claude Code in
// headless mode, resumed from the same session, working in ~/Studio with the brief in director/DIRECTOR.md.
//
//   GET  /api/director/stream      server-sent events: a snapshot, then every change
//   POST /api/director/send        { text, context }     a message (queued while a turn runs)
//   POST /api/director/stop        ends the running turn
//   POST /api/director/reset       starts a new conversation
//
// The conversation is kept in <state>/director/: transcript.jsonl (what the column shows) and session.json
// (the agent's session id, so a restart of the Studio resumes it).
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const MAX_ITEMS = 400;           // what a snapshot carries; the file keeps everything
const short = (s, n) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

// One line for a tool call, the way a person would say it.
function toolSummary(name, input = {}) {
  const f = input.file_path || input.path || input.notebook_path;
  const rel = p => String(p || '').replace(/^.*\/(videos|director|engine)\//, '$1/');
  switch (name) {
    case 'Bash': return short(input.description || input.command, 140);
    case 'Read': return `Read ${rel(f)}`;
    case 'Write': return `Wrote ${rel(f)}`;
    case 'Edit': case 'MultiEdit': return `Edited ${rel(f)}`;
    case 'Glob': case 'Grep': return `Searched for ${short(input.pattern, 80)}`;
    case 'WebFetch': return `Fetched ${short(input.url, 100)}`;
    case 'WebSearch': return `Searched the web for ${short(input.query, 80)}`;
    case 'Task': case 'Agent': return `Started a worker: ${short(input.description || input.prompt, 100)}`;
    case 'TodoWrite': return 'Updated the plan';
    default: return name;
  }
}

export function createDirector({ STATE, HOME, APP, port }) {
  const dir = path.join(STATE, 'director');
  fs.mkdirSync(dir, { recursive: true });
  const TRANSCRIPT = path.join(dir, 'transcript.jsonl'), SESSION = path.join(dir, 'session.json');
  const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };

  // the transcript, collapsed by id (a streamed reply is written once, when it is complete)
  const items = new Map();
  try {
    for (const line of fs.readFileSync(TRANSCRIPT, 'utf8').split('\n')) {
      if (!line) continue;
      try { const it = JSON.parse(line); items.set(it.id, it); } catch {}
    }
  } catch {}
  // a turn the Studio was killed in the middle of is over
  for (const it of items.values()) if (it.pending) { it.pending = false; if (it.role === 'tool') it.status = 'interrupted'; }
  let seq = Math.max(0, ...[...items.keys()].map(k => Number(String(k).split('-')[0]) || 0));
  const newId = () => `${++seq}-${Date.now().toString(36)}`;

  const clients = new Set();
  let child = null, busy = false, stopping = false;
  const waiting = [];            // messages sent while a turn runs: [{ id, prompt }]

  const broadcast = ev => { const data = `data: ${JSON.stringify(ev)}\n\n`; for (const res of clients) res.write(data); };
  const save = it => { fs.appendFileSync(TRANSCRIPT, JSON.stringify(it) + '\n'); };
  function put(it, { persist = true } = {}) {
    items.set(it.id, it);
    if (persist) save(it);
    broadcast({ type: 'item', item: it });
    return it;
  }
  const status = () => ({ busy, queued: waiting.length, agent: agent() ? 'claude' : null });
  const pushStatus = () => broadcast({ type: 'status', ...status() });

  // The brief: the app's DIRECTOR.md, with this machine's paths filled in.
  function brief() {
    let text = '';
    try { text = fs.readFileSync(path.join(APP, 'director', 'DIRECTOR.md'), 'utf8'); } catch {}
    return text.replaceAll('{{APP}}', APP).replaceAll('{{HOME}}', HOME).replaceAll('{{STATE}}', STATE)
      .replaceAll('{{URL}}', `http://127.0.0.1:${port}`);
  }

  let agentPath;
  function agent() {
    if (agentPath !== undefined) return agentPath;
    const bin = process.env.STUDIO_AGENT || 'claude';
    const r = spawnSync('sh', ['-lc', `command -v ${JSON.stringify(bin).slice(1, -1)}`], { encoding: 'utf8' });
    agentPath = r.status === 0 && r.stdout.trim() ? r.stdout.trim().split('\n').pop() : null;
    return agentPath;
  }

  function run(prompt, { fresh = false } = {}) {
    const bin = agent();
    if (!bin) {
      put({ id: newId(), at: Date.now(), role: 'error', text: 'The Director needs Claude Code on this machine. Install it from the Agents surface, sign in, then send your message again.' });
      busy = false; pushStatus(); return;
    }
    busy = true; stopping = false; pushStatus();
    const session = fresh ? null : readJson(SESSION, {}).sessionId;
    const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
      '--append-system-prompt', brief(), '--permission-mode', 'bypassPermissions'];
    if (process.env.STUDIO_DIRECTOR_MODEL) args.push('--model', process.env.STUDIO_DIRECTOR_MODEL);
    if (session) args.push('--resume', session);
    fs.mkdirSync(HOME, { recursive: true });
    const p = child = spawn(bin, args, {
      cwd: HOME, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, STUDIO_APP: APP, STUDIO_HOME: HOME, STUDIO_STATE: STATE, STUDIO_URL: `http://127.0.0.1:${port}` },
    });

    // streamed blocks by index within the current message; tool calls by id
    let blocks = new Map(), tools = new Map(), buf = '', errText = '', sawResult = false, resumeFailed = false;
    const textItem = () => ({ id: newId(), at: Date.now(), role: 'assistant', text: '', pending: true });
    function onEvent(e) {
      if (e.type === 'system' && e.subtype === 'init' && e.session_id) {
        fs.writeFileSync(SESSION, JSON.stringify({ sessionId: e.session_id, at: Date.now() }));
      } else if (e.type === 'stream_event' && !e.parent_tool_use_id) {
        const ev = e.event;
        if (ev.type === 'message_start') blocks = new Map();
        else if (ev.type === 'content_block_start' && ev.content_block?.type === 'text') {
          const it = textItem(); blocks.set(ev.index, it); put(it, { persist: false });
        } else if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
          const it = blocks.get(ev.index);
          if (it) { it.text += ev.delta.text; broadcast({ type: 'delta', id: it.id, text: ev.delta.text }); }
        } else if (ev.type === 'content_block_stop') {
          const it = blocks.get(ev.index);
          if (it) { it.pending = false; blocks.delete(ev.index); if (it.text.trim()) put(it); else { items.delete(it.id); broadcast({ type: 'remove', id: it.id }); } }
        }
      } else if (e.type === 'assistant' && !e.parent_tool_use_id) {
        for (const b of e.message?.content || []) if (b.type === 'tool_use' && !tools.has(b.id)) {
          const it = { id: newId(), at: Date.now(), role: 'tool', name: b.name, text: toolSummary(b.name, b.input), status: 'running', pending: true };
          tools.set(b.id, it); put(it, { persist: false });
        }
      } else if (e.type === 'user' && !e.parent_tool_use_id) {
        for (const b of e.message?.content || []) if (b.type === 'tool_result' && tools.has(b.tool_use_id)) {
          const it = tools.get(b.tool_use_id); tools.delete(b.tool_use_id);
          it.status = b.is_error ? 'failed' : 'done'; it.pending = false;
          if (b.is_error) it.detail = short(typeof b.content === 'string' ? b.content : JSON.stringify(b.content), 600);
          put(it);
        }
      } else if (e.type === 'result') {
        sawResult = true;
        if (e.is_error || e.subtype !== 'success') {
          const msg = String(e.result || e.errors?.join('; ') || e.subtype || 'The turn failed');
          if (session && /No conversation found|session/i.test(msg)) resumeFailed = true;
          else put({ id: newId(), at: Date.now(), role: 'error', text: short(msg, 1200) });
        }
      }
    }
    p.stdout.on('data', d => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        try { onEvent(JSON.parse(line)); } catch (err) { console.error('director: bad event', err.message); }
      }
    });
    p.stderr.on('data', d => { errText = (errText + d).slice(-4000); });
    p.on('error', err => { errText += String(err); });
    p.on('close', code => {
      child = null;
      for (const it of [...blocks.values(), ...tools.values()]) {
        it.pending = false;
        if (it.role === 'tool') it.status = stopping ? 'stopped' : 'interrupted';
        if (it.role !== 'assistant' || it.text.trim()) put(it);
      }
      if (resumeFailed || (!sawResult && session && /No conversation found/i.test(errText))) {
        // the saved session is gone (another machine, a wiped cache): start over, once
        fs.rmSync(SESSION, { force: true });
        put({ id: newId(), at: Date.now(), role: 'system', text: 'The previous conversation could not be resumed; starting a new one.' });
        return run(prompt, { fresh: true });
      }
      if (stopping) put({ id: newId(), at: Date.now(), role: 'system', text: 'Stopped.' });
      else if (code !== 0 && !sawResult) put({ id: newId(), at: Date.now(), role: 'error', text: short(errText || `The agent exited with code ${code}.`, 1200) });
      busy = false;
      next();
    });
  }

  function next() {
    const m = waiting.shift();
    if (!m) { pushStatus(); return; }
    const it = items.get(m.id);
    if (it?.queued) { it.queued = false; put(it); }
    run(m.prompt);
  }

  // What you were looking at, so "make this bigger" needs no explanation.
  function contextLine(c = {}) {
    if (!c || !c.key) return '';
    const bits = [`piece ${c.key}${c.title ? ` (“${c.title}”)` : ''}`];
    if (c.root) bits.push(`folder ${c.root}`);
    if (c.fmt) bits.push(`format ${c.fmt}${c.variant ? `, variant ${c.variant}` : ''}`);
    if (c.t != null) bits.push(`at ${Number(c.t).toFixed(2)} s`);
    bits.push(c.file ? `viewing the render ${c.file}` : 'viewing the live preview');
    return `[Studio: the user is looking at ${bits.join('; ')}.]`;
  }

  function submit(text, prompt, extra = {}) {
    const it = put({ id: newId(), at: Date.now(), role: 'user', text, ...extra, queued: busy });
    if (busy) { waiting.push({ id: it.id, prompt }); pushStatus(); }
    else run(prompt);
    return it;
  }

  return {
    status,
    send(text, context) {
      text = String(text || '').trim().slice(0, 8000);
      if (!text) throw new Error('empty message');
      const ctx = contextLine(context);
      return submit(text, ctx ? `${ctx}\n\n${text}` : text, context?.key ? { context: { key: context.key, title: context.title, fmt: context.fmt, t: context.t } } : {});
    },
    // a note pinned in the viewer is a message to the Director, with where it was pinned
    note(ev) {
      const where = `${ev.key}${ev.fmt ? ` (${ev.fmt})` : ''} at ${Number(ev.t || 0).toFixed(2)} s`;
      const prompt = `[Studio: the user pinned note #${ev.id} on ${where}${ev.file ? `, on the render ${ev.file}` : ''}. Piece folder: ${ev.piece}. ` +
        `Act on it, or hand it to whoever is working on that piece, and mark it with POST /api/notes/update (key "${ev.key}", id ${ev.id}).]\n\n${ev.text}`;
      return submit(ev.text, prompt, { note: { key: ev.key, title: ev.title, t: ev.t, fmt: ev.fmt, id: ev.id } });
    },
    stop() {
      if (!child) return false;
      stopping = true;
      try { process.kill(-child.pid, 'SIGTERM'); } catch {}
      // drop what was waiting too: Stop means stop
      for (const m of waiting.splice(0)) { const it = items.get(m.id); if (it) { it.queued = false; it.dropped = true; put(it); } }
      return true;
    },
    reset() {
      if (child) this.stop();
      fs.rmSync(SESSION, { force: true });
      put({ id: newId(), at: Date.now(), role: 'system', text: 'New conversation.', divider: true });
      pushStatus();
    },
    stream(req, res) {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
      const list = [...items.values()];
      res.write(`data: ${JSON.stringify({ type: 'snapshot', items: list.slice(-MAX_ITEMS), ...status() })}\n\n`);
      clients.add(res);
      const ping = setInterval(() => res.write(': ping\n\n'), 25000);
      req.on('close', () => { clearInterval(ping); clients.delete(res); });
    },
    shutdown() { if (child) try { process.kill(-child.pid, 'SIGTERM'); } catch {} },
  };
}
