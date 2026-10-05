// Cube 24/7 — a seamless 10 s loop: the cube turns once while the sky runs a
// full day (day → dusk → night → dawn → day). Variants: social (clock, line,
// URL) and clean (no text, for backgrounds). Every motion is periodic in the
// loop, so frame 600 == frame 0.
import { createStage } from '/engine/stage.js';
import { buildSky, cubeLook } from '/engine/sky.js';
import { h } from '/engine/lib.js';

const DURATION = 10;
const stage = createStage({ duration: DURATION, fps: 60 });
const { CX, CY, L, variant, layers } = stage;
const TEXT = variant !== 'clean';
const TAU = Math.PI * 2;
const phaseAt = t => ((t / DURATION) % 1 + 1) % 1;

const sky = buildSky(stage);

const CUBE = TEXT
  ? L({ '16x9': [CX, 400, 220], '9x16': [CX, 760, 290], '1x1': [CX, 372, 205], '4x5': [CX, 470, 240] })
  : L({ '16x9': [CX, CY, 250], '9x16': [CX, CY - 40, 320], '1x1': [CX, CY, 280], '4x5': [CX, CY - 20, 290] });
const cubeAt = t => {
  const ph = phaseAt(t);
  return { cx: CUBE[0], cy: CUBE[1] + Math.sin(ph * TAU * 2) * 6, size: CUBE[2], spin: 0.35 + TAU * ph,
    elevation: -18, fillet: 0.57, height: 0.93, look: cubeLook(ph) };
};
stage.cube(cubeAt);

// ---- social variant: a 24 h clock, the line, the URL ----------------------
let clockV, dot;
if (TEXT) {
  const S = L({ '16x9': 1, '9x16': 1.3, '1x1': 0.95, '4x5': 1.1 });
  const over = h('div', { class: 'layer hero', style: { color: '#fff' } });
  dot = h('i', { style: { display: 'inline-block', width: `${10 * S}px`, height: `${10 * S}px`, borderRadius: '50%', background: '#4ade80', boxShadow: '0 0 12px #4ade80', marginRight: `${10 * S}px`, verticalAlign: 'middle' } });
  const clock = h('div', { class: 'abs', style: { left: `${L({ '16x9': 72, '9x16': 72, '1x1': 60, '4x5': 64 })}px`, top: `${L({ '16x9': 60, '9x16': 110, '1x1': 54, '4x5': 64 })}px`, fontVariantNumeric: 'tabular-nums' } },
    h('div', { style: { fontSize: `${17 * S}px`, fontWeight: 500, letterSpacing: '.08em', opacity: 0.85 } }, dot, document.createTextNode('CUBE · ONLINE')),
    h('div', { style: { fontSize: `${54 * S}px`, fontWeight: 500, marginTop: '2px', letterSpacing: '-0.01em' } }));
  clockV = clock.lastChild;
  const line = h('div', { class: 'abs', style: { left: 0, width: `${stage.W}px`, textAlign: 'center', top: `${L({ '16x9': 668, '9x16': 1120, '1x1': 648, '4x5': 812 })}px` } },
    h('div', { style: { fontSize: `${L({ '16x9': 104, '9x16': 132, '1x1': 96, '4x5': 110 })}px`, fontWeight: 500, letterSpacing: '-0.02em', lineHeight: '1.05' }, text: 'Always on.' }),
    h('div', { style: { fontSize: `${L({ '16x9': 34, '9x16': 46, '1x1': 32, '4x5': 38 })}px`, fontWeight: 500, marginTop: `${18 * S}px`, lineHeight: '1.2' },
      html: stage.fmt === '9x16' ? 'Your agents keep running,<br>day and night.' : 'Your agents keep running, day and night.' }));
  const url = h('div', { class: 'abs', style: { left: 0, width: `${stage.W}px`, textAlign: 'center', top: `${L({ '16x9': 972, '9x16': 1470, '1x1': 990, '4x5': 1236 })}px`, fontSize: `${26 * S}px`, fontWeight: 500, letterSpacing: '.06em' }, text: 'cube.computer' });
  over.append(clock, line, url);
  layers.over.appendChild(over);
}

stage.onFrame(t => {
  const ph = phaseAt(t);
  sky(ph, t, cubeAt(t));
  if (clockV) {
    const mins = Math.floor(12 * 60 + 1440 * ph) % 1440;         // noon at frame 0, a full day per loop
    clockV.textContent = `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
    dot.style.opacity = 0.55 + 0.45 * (0.5 + 0.5 * Math.cos(ph * TAU * 8));
  }
});

stage.start();
