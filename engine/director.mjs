// The Director: one long-running conversation with a coding agent that runs the Studio for you. It lives in the
// Studio's left column. Each message you send, each note you pin and each render that ends becomes one turn of
// the agent in headless mode (Claude Code or Codex), resumed from the same session, working in ~/Studio with the
// brief in director/DIRECTOR.md and every permission granted, as Cube's personas run.
//
//   GET  /api/director/stream      server-sent events: a snapshot, then every change
//   POST /api/director/send        { text, context }     a message (queued while a turn runs)
//   POST /api/director/stop        ends the running turn
//   POST /api/director/reset       starts a new conversation
//   POST /api/director/agent       { agent: "claude" | "codex" }   switches agent (a new conversation)
//
// The conversation is kept in <state>/director/: transcript.jsonl (what the column shows) and settings.json (the
// chosen agent and each agent's session id, so a restart of the Studio resumes it).
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

// ---- the agents ----------------------------------------------------------------------------------------
// An adapter turns one turn into a command line, and the agent's JSON lines into the same few operations:
//   { session } · { text: [key, delta] } · { textEnd: key } · { tool: [key, name, summary] }
//   { toolEnd: [key, ok, detail] } · { error } · { done }
const AGENTS = {
  claude: {
    label: 'Claude Code',
    args: ({ prompt, session, brief, model }) => [
      '-p', prompt, '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
      '--append-system-prompt', brief, '--permission-mode', 'bypassPermissions',
      ...(model ? ['--model', model] : []), ...(session ? ['--resume', session] : [])],
    missingSession: msg => /No conversation found/i.test(msg),
    parse(e, ops) {
      if (e.parent_tool_use_id) return;                     // a worker's inner turn: its result reaches us as a tool
      if (e.type === 'system' && e.subtype === 'init' && e.session_id) ops.push({ session: e.session_id });
      else if (e.type === 'stream_event') {
        const ev = e.event;
        if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') ops.push({ text: [`${ev.index}`, ev.delta.text] });
        else if (ev.type === 'content_block_stop') ops.push({ textEnd: `${ev.index}` });
        else if (ev.type === 'message_start') ops.push({ textEnd: '*' });
      } else if (e.type === 'assistant') {
        for (const b of e.message?.content || []) if (b.type === 'tool_use') ops.push({ tool: [b.id, b.name, toolSummary(b.name, b.input)] });
      } else if (e.type === 'user') {
        for (const b of e.message?.content || []) if (b.type === 'tool_result') {
          ops.push({ toolEnd: [b.tool_use_id, !b.is_error, b.is_error ? short(typeof b.content === 'string' ? b.content : JSON.stringify(b.content), 600) : ''] });
        }
      } else if (e.type === 'result') {
        if (e.is_error || e.subtype !== 'success') ops.push({ error: String(e.result || e.errors?.join('; ') || e.subtype || 'The turn failed') });
        ops.push({ done: true });
      }
    },
  },
  codex: {
    label: 'Codex',
    // developer_instructions is a TOML string; a JSON string literal is a valid TOML basic string
    args: ({ prompt, session, brief, model }) => [
      'exec', ...(session ? ['resume'] : []), '--json', '--skip-git-repo-check', '--dangerously-bypass-approvals-and-sandbox',
      '-c', `developer_instructions=${JSON.stringify(brief)}`, ...(model ? ['--model', model] : []),
      ...(session ? [session] : []), prompt],
    missingSession: msg => /no rollout found|thread\/resume failed/i.test(msg),
    parse(e, ops) {
      const it = e.item;
      if (e.type === 'thread.started' && e.thread_id) ops.push({ session: e.thread_id });
      else if (e.type === 'item.started' && it) {
        const s = codexSummary(it);
        if (s) ops.push({ tool: [it.id, it.type, s] });
      } else if (e.type === 'item.completed' && it) {
        if (it.type === 'agent_message') { ops.push({ text: [it.id, it.text || ''] }); ops.push({ textEnd: it.id }); }
        else if (it.type === 'error') ops.push({ error: it.message || 'Codex reported an error' });
        else {
          const s = codexSummary(it);
          if (s) {
            ops.push({ tool: [it.id, it.type, s] });          // completed without a start (a file change)
            const ok = !(it.status === 'failed' || (it.exit_code != null && it.exit_code !== 0));
            ops.push({ toolEnd: [it.id, ok, ok ? '' : short(it.aggregated_output || it.error || '', 600)] });
          }
        }
      } else if (e.type === 'turn.failed') { ops.push({ error: e.error?.message || 'The turn failed' }); ops.push({ done: true }); }
      else if (e.type === 'error') ops.push({ error: e.message || 'Codex reported an error' });
      else if (e.type === 'turn.completed') ops.push({ done: true });
    },
  },
};
function codexSummary(it) {
  switch (it.type) {
    case 'command_execution': return short(String(it.command || '').replace(/^\/bin\/(ba)?sh -lc /, '').replace(/^(['"])(.*)\1$/, '$2'), 140);
    case 'file_change': return `Changed ${(it.changes || []).map(c => String(c.path || '').replace(/^.*\/(videos|director|engine)\//, '$1/')).join(', ') || 'files'}`;
    case 'mcp_tool_call': return `${it.server || 'tool'}: ${it.tool || ''}`;
    case 'web_search': return `Searched the web for ${short(it.query, 80)}`;
    case 'todo_list': return 'Updated the plan';
    default: return null;                                  // reasoning and the like stay out of the column
  }
}
export const agentLabels = Object.fromEntries(Object.entries(AGENTS).map(([k, a]) => [k, a.label]));

// Every node the Director (or a worker it starts) runs gets the engine overlay (overlay.mjs).
export const nodeOptions = () => [process.env.NODE_OPTIONS, `--import=${new URL('./overlay.mjs', import.meta.url).href}`].filter(Boolean).join(' ');

export function createDirector({ STATE, HOME, APP, port }) {
  const dir = path.join(STATE, 'director');
  fs.mkdirSync(dir, { recursive: true });
  const TRANSCRIPT = path.join(dir, 'transcript.jsonl'), SETTINGS = path.join(dir, 'settings.json');
  const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
  const settings = () => readJson(SETTINGS, {});
  const saveSettings = patch => { const next = { ...settings(), ...patch }; fs.writeFileSync(SETTINGS, JSON.stringify(next, null, 2)); return next; };
  const sessionOf = a => settings().sessions?.[a] || null;
  const setSession = (a, id) => saveSettings({ sessions: { ...settings().sessions, [a]: id } });

  // the transcript, collapsed by id (a streamed reply is written once, when it is complete)
  const items = new Map();
  try {
    for (const line of fs.readFileSync(TRANSCRIPT, 'utf8').split('\n')) {
      if (!line) continue;
      try { const it = JSON.parse(line); items.set(it.id, it); } catch {}
    }
  } catch {}
  // a turn the Studio was killed in the middle of is over
  for (const it of items.values()) { if (it.pending) { it.pending = false; if (it.role === 'tool') it.status = 'interrupted'; } if (it.queued) it.queued = false; }
  let seq = Math.max(0, ...[...items.keys()].map(k => Number(String(k).split('-')[0]) || 0));
  const newId = () => `${++seq}-${Date.now().toString(36)}`;

  const clients = new Set();
  let child = null, busy = false, stopping = false;
  const waiting = [];            // turns asked for while one runs: [{ id, prompt, event? }]

  const broadcast = ev => { const data = `data: ${JSON.stringify(ev)}\n\n`; for (const res of clients) res.write(data); };
  const save = it => { fs.appendFileSync(TRANSCRIPT, JSON.stringify(it) + '\n'); };
  function put(it, { persist = true } = {}) {
    items.set(it.id, it);
    if (persist) save(it);
    broadcast({ type: 'item', item: it });
    return it;
  }

  // Which agents this machine has, found once on the login shell's PATH (where Cube puts them).
  const found = {};
  function which(name) {
    if (name in found) return found[name];
    const bin = name === 'claude' ? process.env.STUDIO_CLAUDE || 'claude' : process.env.STUDIO_CODEX || 'codex';
    const r = spawnSync('sh', ['-lc', 'command -v "$0"', bin], { encoding: 'utf8' });
    return (found[name] = r.status === 0 && r.stdout.trim() ? r.stdout.trim().split('\n').pop() : null);
  }
  const available = () => Object.keys(AGENTS).filter(which);
  // the chosen agent; else STUDIO_AGENT; else whichever is installed, Claude Code first
  function current() {
    const want = settings().agent || process.env.STUDIO_AGENT;
    if (want && AGENTS[want]) return want;
    return available()[0] || 'claude';
  }
  const status = () => ({ busy, queued: waiting.length, agent: current(), installed: available(), labels: agentLabels });
  const pushStatus = () => broadcast({ type: 'status', ...status() });

  // The brief: the app's DIRECTOR.md, with this machine's paths filled in.
  function brief() {
    let text = '';
    try { text = fs.readFileSync(path.join(APP, 'director', 'DIRECTOR.md'), 'utf8'); } catch {}
    return text.replaceAll('{{APP}}', APP).replaceAll('{{HOME}}', HOME).replaceAll('{{STATE}}', STATE)
      .replaceAll('{{URL}}', `http://127.0.0.1:${port}`);
  }

  function run(prompt, { fresh = false } = {}) {
    const name = current(), A = AGENTS[name], bin = which(name);
    if (!bin) {
      put({ id: newId(), at: Date.now(), role: 'error', text: `The Director needs ${A.label} on this machine. Install it from the Agents surface and sign in, then send your message again.` });
      busy = false; pushStatus(); return;
    }
    busy = true; stopping = false; pushStatus();
    const session = fresh ? null : sessionOf(name);
    fs.mkdirSync(HOME, { recursive: true });
    const model = name === 'claude' ? process.env.STUDIO_DIRECTOR_MODEL : process.env.STUDIO_CODEX_MODEL;
    const p = child = spawn(bin, A.args({ prompt, session, brief: brief(), model }), {
      cwd: HOME, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, STUDIO_APP: APP, STUDIO_HOME: HOME, STUDIO_STATE: STATE, STUDIO_URL: `http://127.0.0.1:${port}`, NODE_OPTIONS: nodeOptions() },
    });

    const texts = new Map(), tools = new Map();
    let buf = '', errText = '', done = false, failed = false, resumeFailed = false;
    const endText = key => {
      for (const [k, it] of texts) if (key === '*' || k === key) {
        texts.delete(k); it.pending = false;
        if (it.text.trim()) put(it); else { items.delete(it.id); broadcast({ type: 'remove', id: it.id }); }
      }
    };
    function apply(op) {
      if (op.session) setSession(name, op.session);
      else if (op.text) {
        const [key, delta] = op.text;
        let it = texts.get(key);
        if (!it) { it = { id: newId(), at: Date.now(), role: 'assistant', text: '', pending: true }; texts.set(key, it); put(it, { persist: false }); }
        it.text += delta; broadcast({ type: 'delta', id: it.id, text: delta });
      } else if (op.textEnd) endText(op.textEnd);
      else if (op.tool) {
        const [key, tool, summary] = op.tool;
        if (tools.has(key)) return;
        const it = { id: newId(), at: Date.now(), role: 'tool', name: tool, text: summary, status: 'running', pending: true };
        tools.set(key, it); put(it, { persist: false });
      } else if (op.toolEnd) {
        const [key, ok, detail] = op.toolEnd, it = tools.get(key);
        if (!it) return;
        tools.delete(key); it.status = ok ? 'done' : 'failed'; it.pending = false;
        if (detail) it.detail = detail;
        put(it);
      } else if (op.error) {
        failed = true;
        if (session && A.missingSession(op.error)) resumeFailed = true;
        else put({ id: newId(), at: Date.now(), role: 'error', text: short(op.error, 1200) });
      } else if (op.done) done = true;
    }
    p.stdout.on('data', d => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        let e; try { e = JSON.parse(line); } catch { continue; }
        const ops = []; A.parse(e, ops); ops.forEach(apply);
      }
    });
    p.stderr.on('data', d => { errText = (errText + d).slice(-4000); });
    p.on('error', err => { errText += String(err); });
    p.on('close', code => {
      child = null;
      endText('*');
      for (const it of tools.values()) { it.pending = false; it.status = stopping ? 'stopped' : 'interrupted'; put(it); }
      if (resumeFailed || (session && !done && A.missingSession(errText))) {
        // the saved session is gone (another machine, a wiped cache): start over, once
        setSession(name, null);
        put({ id: newId(), at: Date.now(), role: 'system', text: 'The previous conversation could not be resumed; starting a new one.' });
        return run(prompt, { fresh: true });
      }
      if (stopping) put({ id: newId(), at: Date.now(), role: 'system', text: 'Stopped.' });
      else if (code !== 0 && !failed) put({ id: newId(), at: Date.now(), role: 'error', text: short(errText || `${A.label} exited with code ${code}.`, 1200) });
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
    // Something happened in the Studio that the Director supervises (a render ended). Events that arrive while a
    // turn runs are folded into one waiting turn, so ten renders finishing overnight cost one turn, not ten.
    event(text, detail) {
      const pending = waiting.find(m => m.event);
      if (pending) {
        const it = items.get(pending.id);
        it.lines = [...(it.lines || [it.text]), text]; it.text = `${it.lines.length} Studio events`;
        pending.details.push(detail); pending.prompt = eventPrompt(pending.details);
        put(it); return it;
      }
      const it = put({ id: newId(), at: Date.now(), role: 'event', text, queued: busy });
      const m = { id: it.id, event: true, details: [detail], prompt: eventPrompt([detail]) };
      if (busy) { waiting.push(m); pushStatus(); } else run(m.prompt);
      return it;
    },
    setAgent(name) {
      if (!AGENTS[name]) throw new Error('unknown agent');
      if (name === current()) return status();
      if (child) this.stop();
      saveSettings({ agent: name });
      put({ id: newId(), at: Date.now(), role: 'system', text: `Now with ${AGENTS[name].label}. New conversation.`, divider: true });
      setSession(name, null);
      pushStatus();
      return status();
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
      setSession(current(), null);
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

const eventPrompt = details => `[Studio: you supervise the render queue. ${details.length > 1 ? 'These renders ended' : 'A render ended'}:\n` +
  details.map(d => `- ${d}`).join('\n') +
  `\nQA what finished (frames, loudness, loops), fix and requeue what failed, and tell the user in a line or two what is ready to review. ` +
  `If nothing needs doing, say so in one line.]`;
