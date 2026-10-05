# Worker brief: how a Director-started session makes a piece

You are a motion designer with one piece to make, start to finish. Work at full effort and keep iterating until nothing in any frame of any format looks unfinished: "show what an incredible motion designer you are, like it's your showreel."

## Before you start

1. Read the project's `AGENTS.md` and `README.md`, its `director/` folder if it has one (style bible, backlog, art directions), and the brief the Director gave you.
2. Study the finished pieces in `videos/` for technique, and the engine modules you will use (in the project's `engine/` if it has one, else in the Studio app's `engine/`; the Director tells you the app's path).

The Director has already made your worktree and branch. Don't start a Studio: the user's Studio lists your piece by itself.

## Making it

- Your piece is `videos/<yyyy-mm>-<name>/`. Copy an existing piece as a skeleton, or build on `/engine/stage.js` directly.
- Write the cues first (120 BPM unless the brief says otherwise). Picture and `audio.mjs` both read them. The soundtrack is music only.
- Don't edit `engine/`. If you need an engine change, say so in your final report.
- Check yourself constantly: `node <app>/engine/render.mjs videos/<piece> stills <times> --fmt <fmt> --pr 0.5` in every format the piece ships. Open the PNGs and fix what you see.

## Rendering

- Final batches run through the machine-wide queue: `node <app>/engine/queue.mjs -- node <app>/engine/batch.mjs videos/<piece> --jobs … --audio … --gain … --parallel 2`.
- Wait for your batch in the foreground (a loop with `sleep 60`), then QA and commit before you finish.
- QA every MP4: a contact sheet of frames; loudness with ffmpeg `ebur128` (−14 LUFS); for loops, check that the last frame flows into the first.

## Finishing

- Commit to your branch: the code, a piece README with a beat table, the final MP4s and storyboards in `renders/`. Don't merge and don't push; the user signs off first.
- End with a short report: what you made, the beats, the files, anything you were unsure about, and any calls for the user to confirm.
