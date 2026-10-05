// Creates the Studio's project the first time the app is installed: ~/Studio (STUDIO_HOME), a git repository
// with a starter piece, so there is something to preview before the first conversation. An existing ~/Studio is
// never changed, except for the managed block in its AGENTS.md that names where this app lives.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { APP, HOME, STATE } from './paths.mjs';

const BEGIN = '<!-- cube-studio:begin -->', END = '<!-- cube-studio:end -->';
const block = `${BEGIN}
## The Studio app

This project is made with Cube Studio. The engine, the render scripts and the Director's brief live in the app,
at \`${APP}\`; never edit them there, because an update replaces that folder. A file in this project's own
\`engine/\` or \`brand/\` folder wins over the app's copy of the same path.

- Stills: \`node ${APP}/engine/render.mjs videos/<piece> stills 0,2.5,5 --fmt 9x16 --pr 0.5\`
- Final renders, one at a time through the machine's queue:
  \`node ${APP}/engine/queue.mjs -- node ${APP}/engine/batch.mjs videos/<piece> --jobs 16x9:,9x16: --parallel 2\`
- How to make a piece: \`${APP}/director/DIRECTOR.md\`, then \`${APP}/director/WORKER.md\`.
${END}`;

const AGENTS = `# Studio

Motion pieces, each one code: an HTML/WebGL page whose every frame is a pure function of time, rendered frame
by frame in headless Chromium and encoded with ffmpeg. Pieces live in \`videos/<yyyy-mm>-<name>/\`, renders in
each piece's \`renders/\`. Add your house style here (a style bible, a backlog, art directions in \`director/\`):
the Director reads this file first.

${block}
`;

const GITIGNORE = `# render intermediates (regenerate with render.mjs / audio.mjs)
videos/*/frames*/
videos/*/stills*/
videos/*/logs/
videos/*/*.wav
node_modules/
.DS_Store
.cube-session
`;

const git = (...a) => execFileSync('git', ['-C', HOME, ...a], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
fs.mkdirSync(STATE, { recursive: true });

if (!fs.existsSync(HOME)) {
  fs.mkdirSync(HOME, { recursive: true });
  fs.cpSync(path.join(APP, 'starter'), HOME, { recursive: true });
  fs.writeFileSync(path.join(HOME, 'AGENTS.md'), AGENTS);
  fs.writeFileSync(path.join(HOME, 'CLAUDE.md'), '@AGENTS.md\n');
  fs.writeFileSync(path.join(HOME, '.gitignore'), GITIGNORE);
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  // a machine with no git identity yet still gets its first commit
  let who = [];
  try { git('config', 'user.email'); } catch { who = ['-c', 'user.name=Cube Studio', '-c', 'user.email=studio@cube.invalid']; }
  execFileSync('git', ['-C', HOME, ...who, 'commit', '-q', '-m', 'Start the Studio'], { stdio: 'ignore' });
  console.log(`studio: created ${HOME}`);
} else {
  const f = path.join(HOME, 'AGENTS.md');
  let text = '';
  try { text = fs.readFileSync(f, 'utf8'); } catch {}
  const i = text.indexOf(BEGIN), j = text.indexOf(END);
  if (i >= 0 && j > i) {
    const next = text.slice(0, i) + block + text.slice(j + END.length);
    if (next !== text) { fs.writeFileSync(f, next); console.log(`studio: updated the app's paths in ${f}`); }
  }
  console.log(`studio: ${HOME} already exists; left as it is`);
}
