// A faithful-but-simplified Cube app window (dark), built from the product's
// own tokens: Geist / Geist Mono, #121212 surfaces, hairline borders, the
// Cloud sidebar with Repos · Agents · Machine, and tiled agent panes.
import { h, put, clamp, lerp, inv, E, tw, keys, motionBlur } from './lib.js';

const css = `
.app { position:absolute; left:0; top:0; width:1720px; height:960px; font-family:Geist, system-ui, sans-serif; color:#e8e8e8; }
.app .tl { position:absolute; top:22px; width:13px; height:13px; border-radius:50%; }
.app .tabs { position:absolute; top:14px; left:560px; display:flex; gap:8px; }
.app .tab { font-size:15px; font-weight:500; color:#d6d6d6; background:rgba(255,255,255,.075); border-radius:8px; padding:7px 15px; }
.app .tab.on { background:rgba(255,255,255,.16); color:#fff; }
.app .side { position:absolute; left:0; top:56px; width:500px; height:904px; }
.app .hdr { position:absolute; left:24px; top:12px; height:44px; display:flex; align-items:center; gap:12px; }
.app .hdr .name { font-size:31px; font-weight:600; letter-spacing:-.01em; color:#f3f3f3; }
.app .hdr .ic { color:#8f8f94; font-family:'Geist Mono'; font-size:16px; }
.app .seg { position:absolute; left:236px; top:14px; display:flex; gap:2px; background:rgba(255,255,255,.05); border-radius:9px; padding:3px; }
.app .seg div { font-size:15px; color:#a4a4a8; padding:6px 12px; border-radius:7px; display:flex; gap:7px; align-items:center; }
.app .seg div.on { background:rgba(255,255,255,.12); color:#f0f0f0; }
.app .search { position:absolute; left:22px; top:74px; width:456px; height:46px; border:1px solid rgba(255,255,255,.13); border-radius:9px; box-sizing:border-box; font-size:16px; color:#77777c; padding:12px 16px; }
.app .lbl { position:absolute; left:26px; font-size:13px; font-weight:500; letter-spacing:.08em; color:#8d8d92; }
.app .row { position:absolute; left:12px; width:476px; height:78px; border-radius:10px; }
.app .row.hl { background:rgba(255,255,255,.055); }
.app .row img { position:absolute; left:14px; top:17px; width:42px; height:42px; border-radius:10px; }
.app .row .t1 { position:absolute; left:72px; top:12px; font-size:18px; font-weight:500; color:#f0f0f0; }
.app .row .t2 { position:absolute; left:72px; top:36px; font-size:14.5px; color:#98989d; }
.app .row .t3 { position:absolute; left:72px; top:56px; font-size:13px; color:#b8b8bc; display:flex; align-items:center; gap:7px; }
.app .row .t3 i { width:8px; height:8px; border-radius:50%; background:#34c759; display:inline-block; }
.app .row .run { position:absolute; right:12px; top:22px; font-size:15px; color:#e4e4e4; border:1px solid rgba(255,255,255,.14); border-radius:8px; padding:6px 13px; background:rgba(255,255,255,.04); }
.app .card { position:absolute; left:22px; width:456px; border:1px solid rgba(255,255,255,.12); border-radius:12px; box-sizing:border-box; padding:16px 18px; background:rgba(255,255,255,.025); }
.app .card .k { font-size:14px; font-weight:600; color:#d0d0d4; letter-spacing:.01em; }
.app .card .p { font-family:'Geist Mono'; font-size:16px; color:#4ade80; margin-top:10px; }
.app .spec { position:absolute; left:22px; width:456px; height:58px; border:1px solid rgba(255,255,255,.1); border-radius:10px; box-sizing:border-box; background:rgba(255,255,255,.03); }
.app .spec .k { position:absolute; left:18px; top:18px; font-size:16px; color:#b4b4b8; }
.app .spec .v { position:absolute; right:18px; top:12px; font-size:24px; color:#f4f4f4; font-weight:500; font-variant-numeric: tabular-nums; }
.app .bar { position:absolute; left:18px; right:18px; bottom:10px; height:4px; border-radius:2px; background:rgba(255,255,255,.1); overflow:hidden; }
.app .bar i { position:absolute; left:0; top:0; bottom:0; background:#f0f0f0; border-radius:2px; }
.app .kv { position:absolute; left:22px; width:456px; font-family:'Geist Mono'; font-size:15px; color:#d8d8d8; }
.app .kv span { color:#8f8f94; display:inline-block; width:110px; font-family:Geist; }
.app .toggle { position:absolute; right:40px; width:40px; height:24px; border-radius:12px; background:#5e8bff; }
.app .toggle i { position:absolute; right:3px; top:3px; width:18px; height:18px; border-radius:50%; background:#fff; }
.app .pane { position:absolute; border-radius:13px; background:#1b1b1d; border:1px solid rgba(255,255,255,.085); box-sizing:border-box; overflow:hidden; }
.app .pane .ph { position:absolute; left:0; right:0; top:0; height:44px; display:flex; align-items:center; gap:9px; padding:0 16px; font-size:15px; color:#cfcfd2; white-space:nowrap; }
.app .pane .ph img { width:18px; height:18px; border-radius:4px; }
.app .pane .ph .x { margin-left:auto; color:#8a8a8f; font-size:15px; letter-spacing:6px; }
.app .pane .pb { position:absolute; left:22px; top:58px; right:14px; bottom:14px; font-family:'Geist Mono'; font-size:16px; line-height:1.55; color:#d9d9d9; white-space:pre; }
.app .pane .pb div { height:24.8px; }
.app .pane .st { position:absolute; left:22px; right:14px; bottom:16px; font-family:'Geist Mono'; font-size:14.5px; color:#bdbdbd; white-space:pre; }
.app .dim { color:#8b8b90; } .app .grn { color:#4ade80; } .app .red { color:#f87171; } .app .org { color:#e8845c; } .app .blu { color:#7cb7ff; } .app .ylw { color:#e5c07b; } .app .wht { color:#f4f4f4; }
.app .cursor { display:inline-block; width:9px; height:19px; background:#e8e8e8; vertical-align:-3px; }
.app .main-empty { position:absolute; left:516px; top:64px; width:1188px; height:880px; }
`;

const AGENTS = [
  ['claude', 'Claude Code', 'Anthropic'], ['codex', 'Codex', 'OpenAI'], ['opencode', 'OpenCode', 'Anomaly'],
  ['amp', 'Amp', 'Amp'], ['gemini', 'Gemini CLI', 'Google'], ['hermes', 'Hermes Agent', 'Nous Research'],
];

// Terminal sessions. Each line: [text-with-markup, kind] where kind 'type' = typed by the user.
const SESSIONS = [
  { icon: 'claude', title: '✳ Add retry to the sync worker', lines: [
    ['<span class="org">✻</span> <span class="wht">Claude Code</span>  <span class="dim">~/repos/cube-computer</span>', 'out'],
    ['', 'out'],
    ['<span class="wht">&gt; add retry with backoff to the sync worker</span>', 'type'],
    ['', 'out'],
    ['<span class="grn">⏺</span> Read <span class="blu">src/sync/worker.ts</span> <span class="dim">(212 lines)</span>', 'out'],
    ['<span class="grn">⏺</span> Update <span class="blu">src/sync/worker.ts</span>', 'out'],
    ['  <span class="dim">⎿</span>  <span class="grn">+38</span> <span class="red">−6</span>  retry(3, backoff: 250ms)', 'out'],
    ['<span class="grn">⏺</span> Bash <span class="wht">bun test src/sync</span>', 'out'],
    ['  <span class="dim">⎿</span>  <span class="grn">42 pass</span> · 0 fail', 'out'],
    ['', 'out'],
    ['<span class="dim">✻ Cooked for 3m 12s</span>', 'out'],
  ], status: '<span class="dim">[Opus 5.5]</span> <span class="blu">cube-computer</span> · <span class="grn">main</span>  <span class="grn">▰▰▰▰</span><span class="dim">▱▱▱▱</span> 42%  <span class="blu">2h 16m</span>' },
  { icon: 'codex', title: 'Split the port forwarder into a module', lines: [
    ['<span class="dim">›</span> <span class="wht">split the port forwarder into its own module</span>', 'type'],
    ['', 'out'],
    ['<span class="dim">•</span> Explored <span class="wht">9 files</span>', 'out'],
    ['<span class="dim">•</span> Edited <span class="blu">src/port-forward/index.ts</span> <span class="grn">+64</span> <span class="red">−12</span>', 'out'],
    ['<span class="dim">•</span> Ran <span class="wht">bun test port-forward</span>', 'out'],
    ['  <span class="dim">└</span> <span class="grn">18 passed</span>', 'out'],
    ['', 'out'],
    ['<span class="dim">Worked for 4m 51s</span>', 'out'],
  ], status: '<span class="dim">codex · high · ~/repos/cube-computer</span>' },
  { icon: 'opencode', title: 'E2E tests for worktree adopt', lines: [
    ['<span class="wht">&gt; write e2e tests for worktree adopt</span>', 'type'],
    ['', 'out'],
    ['<span class="grn">✓</span> Created <span class="blu">tests/worktree-adopt.e2e.ts</span>', 'out'],
    ['<span class="grn">✓</span> bun run e2e:worktree-adopt', 'out'],
    ['  <span class="grn">4 assertions passed</span> <span class="dim">· 12.4s</span>', 'out'],
  ], status: '<span class="dim">opencode · build · worktree/adopt</span>' },
  { icon: 'amp', title: 'Speed up cold boot', lines: [
    ['<span class="wht">&gt; profile cold boot, fix the slowest step</span>', 'type'],
    ['', 'out'],
    ['<span class="ylw">◆</span> Traced boot <span class="dim">— 2.41s</span>', 'out'],
    ['<span class="ylw">◆</span> Deferred font + icon loading', 'out'],
    ['<span class="ylw">◆</span> Boot <span class="wht">2.41s → 0.93s</span> <span class="grn">✓</span>', 'out'],
  ], status: '<span class="dim">amp · thread · perf/boot</span>' },
];

export function buildApp(markSVG) {
  document.head.appendChild(h('style', { text: css }));
  const root = h('div', { class: 'app' });
  // chrome
  const lights = ['#ff5f57', '#febc2e', '#28c840'].map((c, i) => h('div', { class: 'tl', style: { left: `${22 + i * 21}px`, background: c } }));
  const tabs = h('div', { class: 'tabs' }, ...['Web', 'API', 'Mobile', 'Infra', 'Docs'].map((t, i) => h('div', { class: 'tab' + (i === 0 ? ' on' : ''), text: t })));
  root.append(...lights, tabs);

  // sidebar
  const side = h('div', { class: 'side' });
  const mark = markSVG('#f2f2f2', { width: 25, height: 25 });
  const hdr = h('div', { class: 'hdr' }, mark, h('div', { class: 'name', text: 'Cloud' }), h('div', { class: 'ic', text: '>_' }));
  const segItems = ['Repos', 'Agents', 'Machine'].map(t => h('div', { text: t }));
  const seg = h('div', { class: 'seg' }, ...segItems);
  const search = h('div', { class: 'search', text: 'Search 21 agents…' });
  const lbl = h('div', { class: 'lbl', style: { top: '140px' }, text: 'INSTALLED' });
  const agentsPanel = h('div', { class: 'abs', style: { left: 0, top: 0, width: '500px', height: '760px' } });
  const rows = AGENTS.map(([k, n, m], i) => {
    const r = h('div', { class: 'row' + (i === 0 ? ' hl' : ''), style: { top: `${166 + i * 84}px` } },
      h('img', { src: `/brand/icons/agent-${k}.png` }),
      h('div', { class: 't1', text: n }), h('div', { class: 't2', text: m }),
      h('div', { class: 't3' }, h('i'), document.createTextNode('Installed')),
      h('div', { class: 'run', text: '▶  Run' }));
    return r;
  });
  agentsPanel.append(search, lbl, ...rows);

  // machine panel (replaces the agent list at the "Machine" beat)
  const machinePanel = h('div', { class: 'abs', style: { left: 0, top: 0, width: '500px', height: '760px' } });
  const specs = [['CPUs', 4, ''], ['Memory', 12, ' GB'], ['Storage', 100, ' GB']].map(([k, v, u], i) => {
    const n = h('div', { class: 'spec', style: { top: `${74 + i * 70}px`, height: i === 2 ? '84px' : '58px' } }, h('div', { class: 'k', text: k }), h('div', { class: 'v', text: `${v}${u}` }));
    if (i === 2) { n.appendChild(h('div', { class: 'bar', style: { bottom: '26px' } }, h('i', { style: { width: '25%' } }))); n.appendChild(h('div', { class: 'abs', style: { left: '18px', top: '62px', fontSize: '13px', color: '#9a9a9f' }, text: '25 GB used' })); }
    return { n, v, u };
  });
  const sshL = h('div', { class: 'lbl', style: { top: '330px' }, text: 'SSH' });
  const sshRow = h('div', { class: 'spec', style: { top: '356px', height: '54px' } }, h('div', { class: 'k', style: { color: '#e8e8e8', top: '16px' }, text: 'Allow SSH from this Mac' }), h('div', { class: 'toggle', style: { top: '15px', right: '16px' } }, h('i')));
  const kv = [['Command', 'ssh cube-bright-otter'], ['Host', 'cube-bright-otter'], ['Port', '22022'], ['User', 'node']].map(([k, v], i) => h('div', { class: 'kv', style: { top: `${430 + i * 36}px`, left: '40px' }, html: `<span>${k}</span>${v}` }));
  machinePanel.append(...specs.map(s => s.n), sshL, sshRow, ...kv);

  const ports = h('div', { class: 'card', style: { top: '760px', height: '118px' } }, h('div', { class: 'k', text: 'Localhost ports: cloud → local' }), h('div', { class: 'p', html: '4321<br>8765' }));
  side.append(hdr, seg, agentsPanel, machinePanel, ports);
  root.appendChild(side);

  // panes
  const main = h('div', { class: 'abs', style: { left: '516px', top: '64px', width: '1188px', height: '880px' } });
  const panes = SESSIONS.map(s => {
    const body = h('div', { class: 'pb' });
    const lines = s.lines.map(([html, kind]) => { const d = h('div', { html: html || ' ' }); body.appendChild(d); return { d, html, kind, text: d.textContent }; });
    const cursor = h('span', { class: 'cursor' });
    const st = h('div', { class: 'st', html: s.status });
    const p = h('div', { class: 'pane' },
      h('div', { class: 'ph' }, h('img', { src: `/brand/icons/agent-${s.icon}.png` }), h('span', { style: { color: '#6ee7a0', fontSize: '13px' }, text: '◌' }), h('span', { text: s.title }), h('span', { class: 'x', text: '⤢ ✕' })),
      body, st);
    main.appendChild(p);
    return { p, body, lines, cursor, st };
  });
  root.appendChild(main);

  // --- state setters -------------------------------------------------------
  // Streams a session: typed lines type out, output lines appear one by one.
  function stream(pane, t, t0, rate = 0.075, typeSpeed = 0.012) {
    let tt = t0;
    let cursorAt = null;
    pane.lines.forEach((L, i) => {
      if (L.kind === 'type') {
        const n = L.text.length, dur = n * typeSpeed + 0.05;
        const k = Math.floor(clamp((t - tt) / dur) * n);
        if (t < tt) { L.d.innerHTML = ' '; L.d.style.opacity = 0; }
        else if (k < n) { L.d.style.opacity = 1; L.d.textContent = L.text.slice(0, k); cursorAt = L.d; }
        else { L.d.innerHTML = L.html; L.d.style.opacity = 1; }
        tt += dur + 0.06;
      } else {
        const u = clamp((t - tt) / 0.09);
        if (u <= 0) { L.d.style.opacity = 0; }
        else { L.d.innerHTML = L.html || ' '; L.d.style.opacity = u; L.d.style.transform = `translateY(${(1 - E.outCubic(u)) * 6}px)`; }
        if (u > 0 && u < 1) cursorAt = null;
        tt += L.html ? rate : rate * 0.4;
      }
    });
    if (cursorAt) cursorAt.appendChild(pane.cursor);
    else if (pane.cursor.parentNode) pane.cursor.remove();
    pane.st.style.opacity = clamp((t - t0 - 0.1) / 0.2);
    return tt;
  }

  return { root, lights, tabs, side, hdr, mark, seg, segItems, agentsPanel, machinePanel, rows, search, lbl, specs, sshL, sshRow, kv, ports, main, panes, stream };
}
