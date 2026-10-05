// The feature series' plate cues (seconds), shared by the picture (engine/series.js) and the music
// (engine/series-audio.mjs). No imports, so Node and the browser can both load it.
//
//   const C = seriesCues(BEAT);        // or seriesCues(BEAT, at) for a plate that starts at `at`
//   C.dock, C.number, C.title, C.end, C.run(k), C.word(k)
export const EPISODES = 12;            // twelve numbered episodes, then the finale ("Docs")

export function seriesCues(beat = 60 / 128, at = 0) {
  const c = {
    at,
    hud: at + 0.06,                    // the rule starts drawing in; the label follows at `label`
    dock: at + beat,                   // beat 2: the mark leaves the centre…
    dockDur: 0.5,                      // …and sits in the HUD's corner at dock + dockDur
    number: at + beat + 0.04,          // the number (or "Docs") rises in signal red
    title: at + 2 * beat,              // beat 3: the title's first word (and the glyph); the segment starts filling red
    end: at + 4 * beat,                // the downbeat of bar 2: the plate hands over to the episode
  };
  c.label = c.hud + 0.08;                              // "CUBE COMPUTER — FEATURES"
  c.counter = c.hud + 0.18 + c.dockDur * 0.5;          // "08 / 12", as the mark comes in beside it
  c.run = k => c.hud + 0.12 + k * 0.022;               // segment k (0 … 11) draws in: a run of twelve
  c.word = k => c.title + k * 0.045;                   // the title's k-th word
  return c;
}

// The title's words, as the plate sets them ('\n' forces a line break and isn't a word).
export const titleWords = title => String(title || '').split(/\s+/).filter(Boolean);
