# Frontend — Client Strategy

> Architecture doc. Decided 2026-08-22. Framework choice is **pending** the FE engineer's call;
> everything here holds regardless of framework.

## Decision: PWA first, native shell later, native rewrite possible

| Stage | What | When |
|---|---|---|
| **1. PWA** | One web codebase. Installable, service worker, Web Push, camera, geolocation, share sheet, canvas poster — all browser APIs | Now |
| **2. Capacitor shell** | Same web app wrapped for App Store / Play. Adds native push (APNs/FCM), the Instagram story intent, store presence | When push-on-iOS or store presence matters, or a mobile dev joins |
| **3. Native rewrite** (Flutter or similar) | Replaces the shell under the **same bundle ID / application ID**. The stores treat it as a version update | If and when a mobile dev makes it worth it |

**Why:** two engineers, ~10–15 h/week combined. One codebase is the constraint, not a preference.
And the thing that makes the product work — a WhatsApp link opens a case and a sighting is one tap
away, no install — is a web property. Native is a distribution channel on top of it.

### Rejected
- **Native app first** — two surfaces, install friction before anyone can publish, store review in
  the loop. At this hour budget it doesn't ship.
- **Flutter web / cross-platform-from-day-one** — solves a problem we don't have yet with a
  toolchain neither engineer is fastest in.

### So the rewrite stays cheap
- **Play App Signing** enrolled from the first Android build — the signing key is never a file
  someone can lose.
- **Nothing the app needs lives in WebView storage.** Auth, drafts that matter, preferences: server.
  A rewrite reads nothing local; users log in once more.
- Push tokens are per-install; a new binary re-registers on first launch. The backend's
  `push_subscription` table already expects that.
- Apple guideline 4.2 ("just a website") — the shell must feel like an app: native push, share,
  camera. Ours does by construction.

---

## Push, by platform

| Platform | Stage 1 (PWA) | Stage 2 (Capacitor) |
|---|---|---|
| Android / Chrome | **Web Push** works fully, installed or not | FCM via plugin |
| iOS / Safari | Web Push **only after Add to Home Screen** (iOS ≥ 16.4); a Safari tab gets nothing | APNs via plugin, like any app |

What this means for the product:
- **Owners are who need push** (check-ins, claims, sightings). They're engaged enough for a
  one-screen instruction. At publish time on iOS, before the first check-in would fire:
  > «Para recibir avisos en iPhone: toca Compartir → Añadir a pantalla de inicio, y abre la app
  > desde ahí.»
  Shown once, dismissible, repeated only if no subscription exists when a priority push is due.
- **Helpers are mostly anonymous** and reached via WhatsApp. Push for them is a bonus.
- Android carries ~75–80% of Colombia; the iOS gap is real but narrow.

Backend contract: one `push_subscription` table, `kind: webpush | fcm | apns`, `token`,
`person_id`, `device`, `created_at`, `last_seen_at`. Web Push from day one; stage 2 adds two kinds
and a sender, not a redesign. (Backend doc: pending — the contract above is what it must honor.)

---

## What the frontend owns (and the backend must not assume)

| Concern | FE responsibility | Reference |
|---|---|---|
| **Image preparation** | Downscale ≤ 1600 px, JPEG ~0.82, EXIF dropped by re-encode, HEIC decode, orientation applied first. Upload via signed URL | [11-media](../11-media.md) §1 |
| **Poster** | Canvas render, three formats, photo framer, QR generated locally, bundled fonts, `document.fonts.ready`. The crop never leaves the device | [10-sharing](../10-sharing.md) §3 |
| **Share** | `navigator.share({files, text})` with download + clipboard fallback; `wa.me/?text=` | [10-sharing](../10-sharing.md) §4 |
| **Validation for feedback** | Distance/time checks on sightings run in the form; the server re-checks. Rate limits are server-only | [04](../04-lost-workflow_draft_1.md) · Validation |
| **Form state across a trip out** | The help flow's link gate (user leaves to create a Vaki campaign) — form state kept on the device, no server draft | [09](../09-help-workflow_draft_1.md) · Publishing |
| **Map** | Area (point + radius chips) for last-seen / found / adoption location; sighting pins with age bands and trajectory line; 200 m public floor rendered client-side from server-provided center + radius | [04](../04-lost-workflow_draft_1.md) · Location precision, Display rules |
| **Offline-ish** | Service worker caches the shell and fonts; a case page opened from a link must render with a flaky connection once loaded. Writes are online-only; a failed write keeps the form |  |
| **Geolocation** | Optional everywhere. Never a validation input (many deny it); only a convenience for centering the map and sorting the feed |  |

## What the frontend does NOT own

- **Case pages for crawlers.** WhatsApp's preview bot does not execute JS. The HTML that carries
  `og:image` / `og:title` for `/c/{code}` must be **server-rendered** — by the FE framework's SSR
  or by the backend. Decided with the framework choice; either is fine, one of them must.
- **Short links, `og:image` rendering, image variants** — backend ([10](../10-sharing.md),
  [11](../11-media.md)).
- **Any rule** — row-before-channel, rate limits, schedules, purge, matching, merge — backend.

---

## Pending

| Decision | Depends on |
|---|---|
| Framework (React/Next, Svelte/SvelteKit, Vue/Nuxt, …) | FE engineer's call |
| Who serves the SSR case pages — FE framework or backend | Framework choice |
| Map library | Framework choice; must render ~100 pins + a polyline on a low-end phone |
| Design system / component kit | FE engineer's call; Figma first |
