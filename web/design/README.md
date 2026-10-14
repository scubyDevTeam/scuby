# Design v3

The design was exported from Claude Design as PNGs (mobile frames at 360 px, exported at 2x).

- `reference/` — committed: the index of every screen by flow, the palette, the two shared
  components and the app icon / splash. Enough to know what exists and to set up tokens.
  Where the code departs from the PNGs, `src/ui/tokens.css` wins: the help accent is the palette's
  **azul tinta `#12365C`**, not the purple `#6F52D9` the palette and the help screens show.
- `screens/` — **not committed** (37 MB, in `.gitignore`): the 71 screens themselves. Get the
  export zip («Scuby — Diseño v3-png.zip») from the team and unzip it here; file names match
  the index.
