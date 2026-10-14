# Sharing — Links, Previews, Posters

> Cross-vertical. Every case — lost, found, adoption, help — gets the same sharing surface; this
> doc defines it once. Depends on [media-pipeline.md](../eng/media-pipeline.md) for image variants.
> Domain identifiers are English/snake_case; Spanish strings are UI copy.

## The organizing insight

**The image never changes; the page does.** A poster on a pole, a story that expired yesterday, a
forward in a WhatsApp group from last month — all of them lead to one short URL that shows the
case's status *today*. «SE BUSCA» printed in February shows «YA ESTÁ EN CASA» to whoever scans it
in March. The follow-up loop keeps status honest; sharing is what makes that honesty reach the
street.

Virality in Colombia lives in WhatsApp. Most shares are a **pasted link**, not a crafted image — so
the link preview is the highest-leverage surface and costs the user nothing. The poster is for the
minority who will put in thirty seconds; print is for the neighborhood.

---

## 1. Short links

Every case gets a **short code** at creation: 5 characters, unambiguous alphabet (no `0/O`, `1/l/I`),
`/c/7K3PQ`. One code for the case's whole life — never reissued, never changed on status
transition. Resolves to the case page, which shows current status as the first thing on screen.

| Case status | What the page shows |
|---|---|
| `active` | The card, the map/sightings, the actions |
| `reunited` · `adopted` · `closed` | A status banner («¡Luna ya está en casa!»), the card, no actions |
| `expired` | «Este aviso fue archivado» — reachable, reopenable by the owner, no broadcast |
| purged | «Este aviso ya no está disponible» — the code still resolves so a poster never 404s |

`created_by` can regenerate nothing: the code is the case's identity in the world.

---

## 2. Link previews (`og:image`)

The surface most people see. Every case page serves per-case OpenGraph and Twitter card tags:

| Tag | Value |
|---|---|
| `og:title` | `SE BUSCA: Luna — Santa Ana` (label · name · barrio) |
| `og:description` | One line: species · size · colors · «se perdió el 10 de febrero» |
| `og:image` | **Server-rendered** 1200×630: photo (`card` variant), label band, name, barrio, status |
| `og:url` | The short link |
| `twitter:card` | `summary_large_image` |

**Rendered server-side, regenerated on status change.** The preview for a reunited case shows
«YA ESTÁ EN CASA» so an old forward doesn't send anyone searching. Rendered on request and cached
by content hash; a status transition invalidates. This is the only server-side image work in this
doc — the template is the same layout as the poster's square format, cropped to 1200×630.

Location on every preview and poster is the **barrio name**, never a point — consistent with the
200 m floor. No phone number on any image: contact is on the page, behind the owner's
`contact_prefs`.

---

## 3. The poster («Afiche»)

Generated **on the device**, HTML canvas, no server. Same data as the preview, three formats:

| Format | Size | For |
|---|---|---|
| `square` | 1080×1080 | Feed posts, WhatsApp image forwards |
| `story` | 1080×1920 | WhatsApp status, Instagram story |
| `print` | A4 portrait @ 300 dpi (2480×3508) | Posters on poles, vet counters, tiendas |

### Layout, top to bottom
1. **Label band** — color and text per vertical and status:

   | Vertical · status | Label |
   |---|---|
   | lost · active | `SE BUSCA` |
   | found · active | `SE ENCONTRÓ` |
   | adoption · active | `EN ADOPCIÓN` |
   | help · active | `NECESITA AYUDA` |
   | any · resolved | `YA ESTÁ EN CASA` · `ADOPTADO` · `YA TIENE AYUDA` |

2. **Photo, edge to edge** — on a pole, the photo *is* the message. Owner-adjustable: zoom slider +
   drag, state `{zoom, panX, panY}` kept relative so switching formats keeps the crop. Redraw
   debounced — a low-end phone must not repaint a 1080 px canvas on every pointer move. «Centrar
   de nuevo» resets.
3. **Name**, then one line of traits (`Perro · Pequeño · Negro y canela`), then the zone chip
   («Se perdió en Santa Ana») and the date with relative time («10 de febrero · hace 3 días»).
4. **QR panel** on a dark block — reads as "here's where you act," not as a footer. QR encodes the
   short link; beside it the link in text («ESCANEA EL CÓDIGO · scuby.co/c/7K3PQ · Información al
   día y contacto directo»). QR generated locally (error-correction M; quiet zone respected; for
   `print`, the QR is at least 30 mm).
5. **One line of footer copy** per vertical: lost/found — «Nadie que de verdad lo tenga te va a
   pedir dinero por adelantado.»; help and adoption — none.

No photo → a large paw glyph and «Sin foto — mira las señas». Never a grey block.

### Fonts and offline
Fonts are bundled (not fetched at draw time) and the canvas waits on `document.fonts.ready`. The
poster must render on a phone with a flaky connection once the page has loaded.

---

## 4. Share actions

One sheet, three buttons, and the right artifact per destination:

| Button | Does |
|---|---|
| **Compartir** | `navigator.share({ files: [png], text })` with the **story** image on mobile (the share sheet's main targets — WhatsApp status, Instagram story — want 9:16) and the pre-written message. Falls back to: download the PNG + copy the message to the clipboard + a toast telling the user what just happened |
| **WhatsApp** | `wa.me/?text=<message + short link>` — text only; the link preview carries the image. The fastest path and the most used |
| **Descargar** | Saves the currently previewed format as PNG (`print` as PDF) |

**Pre-written message** per vertical, always ending in the short link so the preview renders:

> `🔎 SE BUSCA: Luna — Santa Ana, Medellín. Perro pequeño, negro y canela. Se perdió el 10 de febrero. Información al día y contacto: scuby.co/c/7K3PQ`

### Instagram stories, specifically
There is no web API for stories. Two mechanisms, both get our 1080×1920 image into the composer:

- **Web/PWA (v1)** — the OS share sheet: Instagram is a registered image target on Android and
  iOS; the user picks *Story*. Two or three taps. This is what «Compartir» already does.
- **Native app (later)** — `instagram-stories://share` (iOS) / `com.instagram.share.ADD_TO_STORY`
  (Android) with a Meta app ID opens the story composer directly. One tap. Needs a native shell;
  [D12](../open-items.md).

Two limits nobody gets around: a third party **cannot attach a link sticker** (the user adds it by
hand; most won't — which is why the QR is in the image), and nothing reports whether the story was
posted. We record intent only.

### What the owner is told
Under the poster: «Súbelo a tus historias y pega copias impresas cerca de donde se perdió. La
gente del barrio es la que más lo ve.» Copy, not a feature — but it's the instruction that turns a
download into a search.

---

## 5. Events

| Event | Consumer |
|---|---|
| `share.opened {channel: system \| whatsapp \| download, format}` | M — the only evidence a share happened; intent, not outcome. Feeds `resolution_attribution = platform_share` honesty |

Short-link visits are server logs, not events.

---

## Open items

- **D12** native Instagram story intent (needs a native app + Meta app ID).
- Stack: which server-side renderer for `og:image` — decided with [11](../eng/media-pipeline.md)'s transform
  layer, same open item.
