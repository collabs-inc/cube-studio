# Cube Studio

Make motion pieces by talking to a Director. Every video is code: an HTML/WebGL page whose every frame is a pure function of time, stepped frame by frame in headless Chromium and encoded with ffmpeg, with a soundtrack synthesised in Node on the same clock. The Studio shows them side by side with the agent that makes them:

- **Left, the Director.** One long-running conversation with Claude Code or Codex. It pitches ideas, makes pieces (or starts workers that do), renders them, reviews every frame and acts on your notes. Each message carries what you are looking at: the piece, the format and the moment.
- **Middle, the viewer.** A live preview of the piece, the same page the renderer drives, in any format and variant, or any finished render. Pin a note to a moment with N, and it goes to the Director.
- **Right, the render queue.** What is rendering and waiting, in your order; every piece by where it stands; render controls; your renders, to play or download. The Director supervises the queue: whenever a render ends, it checks the result and tells you what is ready.

## Install it on a Cube

Cube Studio is a [Cube app](https://github.com/collabs-inc/cube-computer/blob/apps/docs/apps.md). Add `https://github.com/collabs-inc/cube-studio` in the Apps surface (or install it from the Market), confirm, and open it. The install takes a minute or two: it installs the dependencies (ffmpeg included), a headless Chromium, and creates `~/Studio` with a starter piece.

Your work never lives inside the app, because an update replaces the app's folder:

| What | Where |
|---|---|
| Your pieces and renders | `~/Studio` (a git repository; renders in each piece's `renders/`) |
| Notes, the render queue, the Director's conversation | `~/.local/state/cube-studio` |
| Headless Chromium | `~/.cache/ms-playwright` |
| Frames while rendering | `~/.cache/cube-frames` |

Uninstalling the app leaves all of these in place. The Director runs Claude Code or Codex, whichever the machine has (pick in the column's header), signed in the way you already signed in on that Cube, with every permission granted, as Cube's personas run. It works only in `~/Studio` and never pushes, publishes or deletes without asking.

## How a Cube app is put together

This repository is meant to be read as a template. Everything Cube asks of an app is in four files:

- **`cube.json`** names the app and says how to install and start it:
  ```json
  { "name": "Studio", "icon": "studio/icon.svg", "platforms": ["linux"], "install": "sh install.sh", "start": "node engine/studio.mjs" }
  ```
- **`install.sh`** runs after every clone and update, in the app's folder. It puts dependencies inside the app (`node_modules`) or in a shared cache, and creates the user's data folder once (`engine/setup-home.mjs`), never touching it again.
- **The server** (`engine/studio.mjs`) listens on `$PORT` on `127.0.0.1` and nothing else. Cube's gate signs the user in, so the app has no login of its own. It stops cleanly on SIGTERM.
- **The agent** (`engine/director.mjs`, `director/DIRECTOR.md`) is part of the app: a brief, and a small adapter that runs the machine's own Claude Code or Codex headless, streams its turns to the page, and feeds it what happens in the app (notes, finished renders). An app that comes with its own agent needs nothing more from Cube.

The rest is the app itself.

## Projects

`~/Studio` is always listed. The Studio also lists every repository under `~/repos` that has a `studio.json` at its root (and any listed in `~/.local/state/cube-studio/projects.json`), each with its git worktrees, so pieces that agents make on branches show up under their own status.

A project can carry its own `engine/` and `brand/` folders: a file there wins over the app's copy of the same path, in pages and in Node scripts alike. That is how a brand keeps licensed fonts or its own scene modules in its own private repository and still uses the Studio. The app itself ships open fonts only (Geist, under the OFL).

## Make a piece by hand

```bash
cd ~/Studio
cp -r videos/2026-09-cube-24-7 videos/2026-10-my-piece          # edit comp.json, comp.js, audio.mjs
APP=~/.cube/apps/<id>                                          # where Cube installed the app; ~/Studio/AGENTS.md names it
node $APP/engine/render.mjs videos/2026-10-my-piece stills 0,2.5,5 --fmt 9x16 --pr 0.5
NODE_OPTIONS=--import=file://$APP/engine/overlay.mjs node videos/2026-10-my-piece/audio.mjs videos/2026-10-my-piece/soundtrack.wav
node $APP/engine/queue.mjs -- node $APP/engine/batch.mjs videos/2026-10-my-piece --jobs 16x9:,9x16: --audio videos/2026-10-my-piece/soundtrack.wav --gain -3
```

Formats are 16x9 (1920×1080), 9x16 (1080×1920), 1x1 (1080×1080) and 4x5 (1080×1350), all 60 fps. Rendering is CPU-only, at about 1.5 frames per second per job.

## Layout

```
cube.json, install.sh   the Cube app contract
engine/                 the engine: stage, lib, sky, prism, synth, render, encode, batch, queue, looks
  studio.mjs            the Studio server
  director.mjs          the Director: Claude Code / Codex adapters, transcript, events
  paths.mjs             app, ~/Studio, state, projects, the engine/brand overlay
  overlay.mjs           the same overlay for Node scripts
  setup-home.mjs        creates ~/Studio at install
studio/                 the Studio page
director/               DIRECTOR.md (the Director's brief) and WORKER.md (a worker's)
starter/                what ~/Studio starts with
brand/                  open fonts and the Cube mark
```

## Run it outside Cube

```bash
npm ci && npm run setup
npm run studio            # http://127.0.0.1:4173 ; STUDIO_HOME, STUDIO_STATE, PORT override the defaults
```

The Studio binds to `127.0.0.1` only. Outside Cube nothing signs a visitor in, so don't expose it.
