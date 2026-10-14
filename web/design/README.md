# Design v3

The design was exported from Claude Design as PNGs (mobile frames at 360 px, exported at 2x).

- `reference/` — committed: the index of every screen by flow, the palette, the two shared
  components and the app icon / splash. Enough to know what exists and to set up tokens.
  Where the code departs from the PNGs, `src/ui/tokens.css` wins: the help accent is the palette's
  **azul tinta `#12365C`**, not the purple `#6F52D9` the palette and the help screens show.
  The help screens («Ayuda · …», «Pedir ayuda · primero el enlace») show a money campaign with an
  amount and a Vaki link: **superseded** — help is in kind, never money (00 · #26, 07). So is the
  adoption fee in «Adopción · publicación»: listings have no fee.
- `screens/` — **not committed** (37 MB, in `.gitignore`): the 71 screens themselves. Get the
  export zip («Scuby — Diseño v3-png.zip») from the team and unzip it here; file names match
  the index.
