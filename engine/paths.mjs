// Where things live. The Studio is an app: its own folder (APP) holds the code and is replaced by every
// update, so nothing the user makes is ever written there.
//
//   APP      this repository: engine/, studio/, brand/, director/, node_modules/
//   HOME     the Studio's project, a git repository the app creates at install: ~/Studio (STUDIO_HOME)
//   STATE    the Studio's own bookkeeping: notes, render queue, the Director's conversation
//            ~/.local/state/cube-studio (STUDIO_STATE, or $XDG_STATE_HOME/cube-studio)
//
// A project is any repository with a videos/ folder of pieces. ~/Studio is always one; others are listed in
// STATE/projects.json or found under ~/repos by their studio.json. A project may carry its own engine/ and
// brand/: a file there wins over the app's copy of the same path (the overlay), so a brand with licensed fonts
// or its own scene modules keeps them in its own, private repository.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
export const HOME = path.resolve(process.env.STUDIO_HOME || path.join(os.homedir(), 'Studio'));
export const STATE = path.resolve(process.env.STUDIO_STATE
  || path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'), 'cube-studio'));

const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const isProject = dir => { try { return fs.statSync(path.join(dir, 'videos')).isDirectory(); } catch { return false; } };

// [{ name, root }]: ~/Studio first, then listed projects, then discovered ones. Names are unique.
export function projects() {
  const out = [], seen = new Set();
  const add = (root, name) => {
    root = path.resolve(root);
    if (seen.has(root) || !isProject(root)) return;
    seen.add(root);
    let n = name || path.basename(root), k = 2;
    while (out.some(p => p.name === n)) n = `${name || path.basename(root)}-${k++}`;
    out.push({ name: n, root });
  };
  add(HOME, 'studio');
  for (const p of readJson(path.join(STATE, 'projects.json'), [])) add(typeof p === 'string' ? p : p.root, p.name);
  const repos = process.env.STUDIO_REPOS || path.join(os.homedir(), 'repos');
  let names = [];
  try { names = fs.readdirSync(repos); } catch {}
  for (const n of names.sort()) if (fs.existsSync(path.join(repos, n, 'studio.json'))) add(path.join(repos, n));
  return out;
}

// The repository a piece folder belongs to: the nearest ancestor that has a videos/ folder holding it.
export function projectRootOf(dir) {
  let d = path.resolve(dir);
  while (d !== path.dirname(d)) {
    const up = path.dirname(d);
    if (path.basename(up) === 'videos' && isProject(path.dirname(up))) return path.dirname(up);
    d = up;
  }
  return null;
}

// The file a page's absolute path means inside a project: the project's own file, else the app's for the
// shared trees. Returns null when the path escapes both roots.
const SHARED = /^\/(engine|brand|node_modules)\//;
export function resolveIn(root, rel) {
  const inside = (base, f) => f === base || f.startsWith(base + path.sep);
  const own = path.join(root, rel);
  if (!inside(root, own)) return null;
  if (fs.existsSync(own)) return own;
  if (SHARED.test(rel)) {
    const app = path.join(APP, rel);
    if (inside(APP, app) && fs.existsSync(app)) return app;
  }
  return own;
}

// The engine script a project runs: its own copy when it has one, so its pieces render the way they always did.
export const engineScript = (root, name) => {
  const own = path.join(root, 'engine', name);
  return fs.existsSync(own) ? own : path.join(APP, 'engine', name);
};
