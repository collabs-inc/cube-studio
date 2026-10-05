# Cube 24/7: seamless 10 s loop (2026-09)

The cube turns once while the sky runs a full day: noon, dusk, a starry night with a halo
breathing behind the cube, dawn, and back to noon. Frame 600 is frame 0, so the
clip loops forever on a feed, a website hero or a booth screen. It's the shortest way to say
that Cube keeps your agents running around the clock.

| Time | Clock | Sky |
| --- | --- | --- |
| 0.0–2.0 s | 12:00–16:48 | day (the site's hero gradient) |
| 2.0–4.5 s | 16:48–22:48 | dusk: warm glow low on the left, the cube warms then cools |
| 4.5–7.8 s | 22:48–06:43 | night: stars twinkle, the cube turns midnight blue, halo breathes |
| 7.8–10.0 s | 06:43–12:00 | dawn: peach glow on the right, then back to day |

**Variants**

- `social` (default): a live "CUBE · ONLINE" clock top left, **Always on.** / *Your agents keep
  running, day and night.*, and cube.computer at the bottom.
- `clean`: only the cube and the sky, a larger cube, centred. Use it as a background.

Formats are 16x9, 9x16, 1x1 and 4x5; each one is laid out for its own frame, not cropped.
The music is a 120 BPM loop (Fmaj9 → Dm9 → B♭maj7 → Gm9 → Cadd9, one chord per 2 s). Its pad
filter closes at night and the plucks soften, so the sound follows the light. The loop is rendered
three times and the middle pass is kept, so the reverb tail wraps around the seam. Mixed to −14 LUFS.

## Renders

| File | Format | Variant |
| --- | --- | --- |
| `renders/cube-24-7-16x9.mp4` | 1920 × 1080 | social |
| `renders/cube-24-7-9x16.mp4` | 1080 × 1920 | social |
| `renders/cube-24-7-1x1.mp4` | 1080 × 1080 | social |
| `renders/cube-24-7-4x5.mp4` | 1080 × 1350 | social |
| `renders/cube-24-7-16x9-clean.mp4` | 1920 × 1080 | clean |
| `renders/cube-24-7-9x16-clean.mp4` | 1080 × 1920 | clean |

`renders/storyboard-16x9.jpg` and `renders/storyboard-9x16.jpg` show both variants at 13:12, 18:43, 22:04, 01:55, 07:12 and 10:04.

## Render

From the Studio (`npm run studio`), or from the repo root:

```bash
node videos/2026-09-cube-24-7/audio.mjs videos/2026-09-cube-24-7/soundtrack.wav
node engine/batch.mjs videos/2026-09-cube-24-7 --jobs 16x9:social,9x16:social,1x1:social,4x5:social,16x9:clean,9x16:clean \
  --audio videos/2026-09-cube-24-7/soundtrack.wav --gain -3
```

For platforms that don't loop video, add `--loops 3 --name cube-24-7-30s` to export a 30 s version.
