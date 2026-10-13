# Frontend — Client Architecture and Build Plan

> Architecture doc. Strategy decided 2026-08-22. Framework, stack and layering decided 2026-10-02
> (merges the `docs/vertical-workflows` architecture draft). **Amended 2026-10-05:** two scopes —
> the web launches first; the store apps are a planned medium-term scope. Backend, database and
> infra are out of scope; this covers the app, the store builds, and the rules that keep them one
> thing. Decision log rows:
> [00 · #12, #19, #20](../product/00-product-map.md).

## The decision in one line

**One codebase, two scopes.** First a React SPA (Vite + TanStack Router) that runs on the web and
installs as a PWA. Then, as a planned medium-term scope, the *same* build wrapped by **Capacitor**
into Android and iOS store apps. Screens are written once. The only per-platform code is a thin adapter layer for push,
camera, location, share and storage.

**Why:** two engineers, ~10–15 h/week combined. One codebase is the constraint, not a preference.
The thing that makes the product work — a WhatsApp link opens a case and a sighting is one tap
away, no install — is a web property, so the web launches first and stays the primary surface.
The store apps are the same product for people who want it installed, with native push.

## Scopes

| Scope | What | When |
|---|---|---|
| **1. Web + PWA** | The launch. Installable, service worker, Web Push, camera, geolocation, share sheet, canvas poster — all browser APIs. Lost & Found first, then adoption and help | Now |
| **2. Mobile** (Play Store + App Store) | The same `dist/` in Capacitor, both stores together. Adds FCM/APNs push, native Google sign-in, Sign in with Apple (guideline 4.8), the Instagram story intent (D12), store presence | Medium term: planned, not triggered by metrics. Starts once the web launch is stable; gates in [frontend-plan.md](frontend-plan.md) · Mobile scope |
| **Native rewrite** | React Native preferred: `domain`, `contracts` and `api-client` survive untouched (see *Escape hatches*). Ships under the **same bundle ID / application ID**; the stores treat it as a version update | If and when a mobile dev makes it worth it, or the webview ceiling is reached |

Scope 1 is written so scope 2 changes almost no application code: native access already goes
through `src/platform` (Rule 4), so the mobile scope adds native branches to those modules,
`capacitor.config.ts` and the generated native folders. When it ships, the stores **never gate
the web**: a web release ships the moment it's merged; store binaries are cut only when native code
or plugins change, and JS/asset fixes reach installed apps through live updates (*Stack*).

### What Capacitor costs

The store apps run in a **webview**: scroll physics, keyboard behaviour and transitions read as
web unless tuned, and the map is WebGL inside a webview. Taken with open eyes — users are on
Android, arriving from WhatsApp links, in short urgent bursts. Nobody opens a lost-pet app to
admire the scroll physics. The specific risks and their mitigations are under *Risks*.

### So the rewrite stays cheap

- **Play App Signing** enrolled from the first Android build — the signing key is never a file
  someone can lose.
- **Nothing the app needs long-term lives in WebView storage.** Auth state of record, preferences,
  drafts that matter: server. Two things are deliberately device-local and *transient* — the help
  flow's link-gate form state ([07](../product/07-help-workflow.md) · Publishing) and the sighting
  retry queue (*Risks* §6). Losing them in a rewrite costs nothing.
- Push tokens are per-install; a new binary re-registers on first launch. `push_subscription`
  already expects that.

### Rejected

- **Native app first** — two surfaces, install friction before anyone can publish, store review in
  the loop. At this hour budget it doesn't ship.
- **Next.js + Expo** (the 2026-08-23 draft) — two UIs and two map implementations forever. Correct
  about the tradeoffs, wrong about the price.
- **Expo universal** — the web that comes out of React Native is heavier and less "web" on the one
  surface the growth loop runs through, the map splits into a native and a web implementation,
  and its SSR is still `unstable_`.
- **Flutter (web or native)** — discards the JS ecosystem and is the toolchain neither engineer is
  fastest in. Also the one rewrite target where none of `domain` survives.
- **Stores at launch** (considered 2026-10-05) — two store reviews, Sign in with Apple, account
  deletion and a webview polish pass before a single user exists; the web loop doesn't need any of it.
- **Android first, iOS later on separate triggers** — with Capacitor both shells cost about the
  same, and one mobile scope means one round of native work.
- **TWA for Android** — a second wrapper next to Capacitor for iOS, and no native intents.
- **Remote-URL shell** (`server.url` pointing at the live site) — Capacitor documents it for live
  reload only, and Apple rejects apps that aren't self-contained.

---

## Push, by platform

| Platform | Scope 1 — web (PWA) | Scope 2 — store app |
|---|---|---|
| Android | **Web Push** works fully, installed or not | FCM via plugin |
| iOS | Web Push **only after Add to Home Screen** (iOS ≥ 16.4); a Safari tab gets nothing | APNs via plugin, like any app |

What this means for the product:
- **Owners are who need push** (check-ins, claims, sightings). They're engaged enough for a
  one-screen instruction. At publish time on iOS, before the first check-in would fire:
  > «Para recibir avisos en iPhone: toca Compartir → Añadir a pantalla de inicio, y abre la app
  > desde ahí.»
  Once the store apps exist, the same prompt offers the app first.
  Shown once, dismissible, repeated only if no subscription exists when a priority push is due.
- **Helpers are mostly anonymous** and reached via WhatsApp. Push for them is a bonus.
- Check-in answers from the notification itself (action buttons) and the iOS deep-link fallback:
  [comms.md](comms.md).

Backend contract: one `push_subscription` table, `kind: webpush | fcm | apns`, `token`,
`person_id`, `device`, `created_at`, `last_seen_at`. Web Push from day one; the mobile scope adds
two kinds and their senders, not a redesign. The client registers through `src/platform/push`, which returns `{ kind, token }`
regardless of runtime.

---

## The one server-side thing: case pages for crawlers

The app is a **static SPA**: one bundle, client-rendered, identical on the web and in the shells.
No SSR, no divergence, no second build config.

Exactly one route needs a server — the WhatsApp link preview, because WhatsApp's bot does not run
JS. The route is the short link from [10 · Short links](../product/10-sharing.md):

```
/c/:code  → rewritten to a Vercel function (share.ts, ~100 lines)
            → fetches the public case summary from the backend API
            → reads the built index.html
            → injects og:/twitter: meta + a readable server-rendered summary paragraph
            → returns it; the same SPA bundle boots from the same HTML
```

```json
// vercel.json
{
  "rewrites": [
    { "source": "/c/:code", "destination": "/api/share?code=:code" },
    { "source": "/(.*)",    "destination": "/index.html" }
  ]
}
```

- **No user-agent sniffing**, no separate crawler app: everyone gets the same shell with the meta
  tags and summary filled in. Readable text before any JS runs.
- Tag *content* (title, description, which statuses show what) is owned by
  [10 · Link previews](../product/10-sharing.md). This function only places it.
- The `og:image` URL points at whatever renders the 1200×630 card — `@vercel/og` in a second
  function is one candidate; the choice is [O10](../open-items.md).
- **Everything else is client-rendered**, including feed and map. Those aren't preview targets —
  they just need to be fast, which is a budget problem (below).

---

## Architecture

Four layers plus adapters. Dependencies point inward, always.

```
src/routes/              file-based routes and screens
   └─ src/features       hooks and components — the product
        └─ src/api-client  fetch + TanStack Query
             └─ src/contracts  Zod schemas, generated from the API spec
                  └─ src/domain  pure rules — zero dependencies
src/platform    ← adapters: push, location, camera, share, storage
src/ui          ← shadcn components, tokens, Map/ (lazy)
```

| Layer | May import |
|---|---|
| `domain` | nothing |
| `contracts` | zod |
| `api-client` | `contracts` |
| `platform` | `@capacitor/*`, browser APIs |
| `ui` | react, shadcn deps, maplibre (Map/ only) |
| `features` | `domain`, `contracts`, `api-client`, `ui`, `platform`, react |
| `routes` | everything above |

Enforced in CI with **dependency-cruiser** — a dependency rule in a README is a suggestion.

### Rule 1 — `domain` imports nothing

Plain TypeScript over plain data: not React, not fetch, not Zod. This is what makes the four case
lifecycles testable in milliseconds, and what lets them survive a framework change.

### Rule 2 — the client predicts, the server decides

`domain` decides **what the UI offers**: which buttons render, which are disabled, what the
confirmation copy says, what an optimistic update may assume. It never enforces anything.

- The server owns every transition that matters. «Only the owner closes a case as reunited»
  ([04](../product/04-lost-workflow.md)) is enforced by the backend, or it is not enforced.
- A client-side `null` is an affordance; a server rejection is the truth. The UI must render a
  rejection it did not predict without breaking.
- The two copies of each rule are accepted, and the drift is managed: the backend is not
  TypeScript (Rails — [comms.md](comms.md)), so `contracts` are **generated from the API's OpenAPI
  spec**, and a **contract test suite** replays each machine's transition table against the real
  API and fails when they disagree. In place before the second vertical.

### Rule 3 — no flags, no rules the backend owns

The frontend never reads a feature flag ([feature-flags.md](feature-flags.md)). When a flag changes
a screen, the response carries the outcome — e.g. publish returns `phone_step: otp | unverified`
and the form renders the code entry only for `otp`. Same for rate limits, schedules, purge,
matching, merge: backend. The client may *pre-check* for feedback (sighting distance/time,
[04](../product/04-lost-workflow.md) · Validation); the server re-checks.

### Rule 4 — platform capabilities go through `src/platform`

Nothing in `features` imports a Capacitor plugin or a browser API directly. One module per
capability, one runtime branch inside it:

```ts
// src/platform/location.ts
import { Capacitor } from '@capacitor/core'

export async function getCurrentPosition(): Promise<Point> {
  if (Capacitor.isNativePlatform()) {
    const { Geolocation } = await import('@capacitor/geolocation')
    return toPoint(await Geolocation.getCurrentPosition())
  }
  return toPoint(await getBrowserPosition())
}
```

Five modules — `location`, `camera`, `share`, `push`, `storage` (plus `auth` in the mobile scope,
for the native sign-in plugins — *Risks* §7). In scope 1 they hold only the web branch; the boundary
is what matters, because it means the mobile scope edits these files and no call site. Everything
above them is written once and never asks where it's running. In a native rewrite these are the only files replaced wholesale.

Geolocation is **optional everywhere** — never a validation input (many deny it), only a
convenience for centering the map and sorting the feed.

### Rule 5 — the map lives behind one component and a lazy boundary

`src/ui/Map/` exposes a props interface and nothing else. Markers are **GL symbol layers, never DOM
elements** — a few hundred DOM pins crawl on desktop too, and blaming the webview for that is the
classic misdiagnosis. MapLibre GL JS (~250 KB gzip) is `React.lazy`-loaded and must never appear in
the entry chunk — the case page opened from a link does not need it to render. CI fails if it does.

What the map must draw is owned by [04](../product/04-lost-workflow.md) · Location precision and
Display rules: areas (point + radius chips) for last-seen / found / adoption location, sighting
pins with age bands and a trajectory line, and the **200 m public floor applied at render** from
the server-provided center + radius.

---

## What the frontend owns

| Concern | FE responsibility | Owning doc |
|---|---|---|
| **Image preparation** | Downscale ≤ 1600 px long edge, **JPEG ~0.82** (≈300 KB), orientation applied first, EXIF dropped by re-encode, HEIC decode. Upload via short-lived signed URL. Failed upload keeps the preview and retries | [media-pipeline](media-pipeline.md) §1 |
| **Poster** | Canvas render, three formats, photo framer, QR generated locally, bundled fonts, `document.fonts.ready`. The crop never leaves the device | [10](../product/10-sharing.md) §3 |
| **Share** | `navigator.share({files, text})` with download + clipboard fallback; `wa.me/?text=` | [10](../product/10-sharing.md) §4 |
| **Phone step** in every publish flow | Inline field, country prefilled from `supported_countries`, libphonenumber format check, OTP entry when told `otp` | [auth.md](auth.md) · UI contract |
| **Sign-in** | Google one-tap + email 6-digit code (the mobile scope adds the native Google plugin and Apple); accounts born lazily at the first gated action; no signup screen | [auth.md](auth.md) |
| **Validation for feedback** | Distance/time checks on sightings in the form; server re-checks | [04](../product/04-lost-workflow.md) · Validation |
| **Form state across a trip out** | Help flow link gate — kept on the device, no server draft | [07](../product/07-help-workflow.md) · Publishing |
| **Map** | Rule 5 above | [04](../product/04-lost-workflow.md) |
| **Offline-ish** | Service worker caches shell and fonts; a case page opened from a link renders on a flaky connection once loaded. Writes online-only, except the sighting queue (*Risks* §6); a failed write keeps the form | — |
| **Case lifecycles as UI model** | One machine per vertical in `src/domain` (below) | [04](../product/04-lost-workflow.md)–[07](../product/07-help-workflow.md) · state machines |

## What the frontend does NOT own

- **Short codes, `og:image` rendering, image variants** — backend ([10](../product/10-sharing.md),
  [media-pipeline](media-pipeline.md)). The share function only injects tags.
- **Events.** Events are rows written by the backend in the same transaction as the thing they
  describe ([08 · Global rules](../product/08-notifications.md)). The client emits none in v1; a
  client-side event needs an **M**-tagged consumer that can't be derived from rows. Sentry is
  error reporting, not analytics.
- **Any rule** — row-before-channel, rate limits, schedules, purge, matching, merge, flags.

---

## State machines

The case lifecycles in [04](../product/04-lost-workflow.md)–[07](../product/07-help-workflow.md)
are transcribed into `src/domain`, one file per vertical, as discriminated unions plus a pure
`transition()` — under Rule 2, the UI's model of the server's rules:

```ts
// src/domain/lost/machine.ts
type Status = 'active' | 'reunited' | 'expired' | 'cancelled'

type Event =
  | { type: 'OWNER_CONFIRMS_REUNION' }
  | { type: 'OWNER_CANCELS' }
  | { type: 'CHECKIN_UNANSWERED'; consecutive: number }
  | { type: 'OWNER_REOPENS'; daysSinceExpiry: number }

export function transition(status: Status, event: Event): Status | null {
  if (status === 'active' && event.type === 'OWNER_CONFIRMS_REUNION') return 'reunited'
  if (status === 'active' && event.type === 'OWNER_CANCELS') return 'cancelled'
  if (status === 'active' && event.type === 'CHECKIN_UNANSWERED')
    return event.consecutive >= 2 ? 'expired' : 'active'
  if (status === 'expired' && event.type === 'OWNER_REOPENS')
    return event.daysSinceExpiry <= 30 ? 'active' : null
  return null   // the UI does not offer this
}
```

Without it, «the owner may close this case» lives in a button's `onClick`, the check-in banner and
the case header — three copies inside the client alone. One function, one answer, one test file.
Derived badges (e.g. «posible hallazgo» = open claim exists) are selectors, never statuses.

**Not XState** — the machines are small and flat. Revisit if one grows nested states.

---

## Budgets

The growth loop is a stranger on a Redmi A3-class Android, on 4G, opening a WhatsApp link. A number
beats an intention.

| What | Budget | Enforced by |
|---|---|---|
| `/c/:code` — JS transferred, first load | **≤ 150 KB gzip** (map excluded) | `size-limit` in CI |
| `/c/:code` — LCP | **≤ 2.0 s** on Slow 4G, mid-tier Android | Lighthouse CI on every PR |
| Map cold load | **≤ 2.0 s** to first interactive tiles | manual on the reference device |
| Uploaded photo | ≈ 300 KB, ≤ 1600 px, JPEG | client pipeline ([media-pipeline](media-pipeline.md)) |

**Sentry from the first deploy**, with uploaded sourcemaps — `@sentry/react`; `@sentry/capacitor`
arrives with the mobile scope. Users don't file bugs, they stop coming back.

---

## Stack

| | |
|---|---|
| Build | **Vite** + React 19 + TypeScript strict |
| Router | **TanStack Router** — file-based, type-safe params, SPA |
| Styling | **Tailwind + shadcn/ui** |
| Map | **MapLibre GL JS** + **Protomaps** tiles — GL symbol layers, lazy-loaded |
| Server state | **TanStack Query** (+ persister for the sighting queue) |
| Forms | **react-hook-form + Zod** |
| Contracts | Zod + types generated from the backend's OpenAPI spec |
| API mocking | **MSW** — lets the frontend build against the contract before the backend exists |
| PWA | **vite-plugin-pwa** (Workbox) — installable shell, Web Push |
| Errors | **Sentry** |
| Deploy | **Vercel** — static `dist/` + the share function |
| Native shell *(scope 2)* | **Capacitor** (current major; `webDir: 'dist'`); plugins `push-notifications` · `geolocation` · `camera` · `share` · `app` (deep links, back button) · `system-bars` / `status-bar` · `keyboard` · `preferences` · `splash-screen` |
| Native sign-in *(scope 2)* | Google: Capawesome Google Sign-In or `@capgo/capacitor-social-login` (Credential Manager on Android, Google SDK on iOS). Apple: Sign in with Apple through the same plugin family. Behind `src/platform/auth` |
| Live updates *(scope 2)* | **Capgo** or **Capawesome** — JS/asset fixes reach installed apps without review (Apple 3.3.2 allows it for JS and assets, never a change of purpose). Not Ionic Appflow: closed to new customers, shuts down 2027-12-31 |
| Store builds *(scope 2)* | GitHub Actions — macOS runner for iOS (no Mac required), Linux for Android; signing secrets in CI, never in the repo |
| Tooling | **Biome** (lint + format) · dependency-cruiser · size-limit · **Vitest** on `domain` · **Playwright** web e2e · Lighthouse CI on `/c/:code` |

Pin the current major of each at scaffold time — this doc goes stale faster than the ecosystem.

### Rejected

| Decision | Rejected & why |
|---|---|
| Vite + TanStack Router | **Next.js `output: 'export'`** — gives up SSR, RSC, ISR, middleware, `next/image` (every reason to run it), keeps the App Router's complexity, and cannot statically export `/c/[code]` (codes are created at runtime). **React Router 7 framework mode** — SSR-shaped, we have no server. **TanStack Start** — a server we don't need yet; it is the in-place upgrade if we ever do |
| One function injects OG into the shell | UA-sniffing (fragile); prerendering every case (unbounded ids); no server at all (kills the WhatsApp loop) |
| One app, folders | Monorepo / workspaces — one deployable. A TS backend sharing `domain` was the only thing that would justify it; the backend is Rails |
| MapLibre + Protomaps | Google Maps / Mapbox — bill per load, and this map is opened constantly by strangers who never sign up |
| Discriminated unions + `transition()` | XState (nothing to justify it); scattered conditionals (copies that drift) |
| Biome | ESLint + Prettier — two tools, more config, no benefit at this size |
| JPEG client re-encode | WebP — Safari's canvas can't reliably encode it, and the server re-encodes the master as JPEG anyway ([media-pipeline](media-pipeline.md) §1) |

---

## Folder structure

The app lives in **`web/`** in this repo, so a backend can sit beside it without moving anything.
Vercel's project root is `web/`.

```
web/
├── index.html
├── vercel.json                 /c/:code → share function, everything else → SPA
├── api/
│   └── share.ts                injects OG meta + summary into the built shell
├── src/
│   ├── routes/                 TanStack Router, file-based
│   │   ├── __root.tsx
│   │   ├── c.$code.tsx         the case page (any vertical)
│   │   ├── index.tsx           feed + map
│   │   └── _auth/              session required: publicar, mis-casos, bandeja, perfil
│   ├── domain/                 pure, zero deps, advisory (Rule 2)
│   │   ├── lost/  found/  adoption/  help/  shared/
│   ├── contracts/              generated Zod schemas
│   ├── api-client/             fetch + TanStack Query hooks
│   ├── features/               lost/  found/  adoption/  help/  sharing/  auth/
│   ├── ui/                     shadcn + tokens + Map/ (lazy)
│   ├── platform/               location · camera · share · push · storage
│   └── mocks/                  MSW handlers + fixtures
├── android/  ios/              scope 2: Capacitor native projects — absent until then
└── capacitor.config.ts         scope 2: app id, webDir, plugin config
```

Feature folders, not type folders: `features/lost/` beats `hooks/`, `screens/`, `utils/` the moment
there are four verticals. Route names are Spanish (they are UI); identifiers are English.

---

## Build plan

Step by step, from the design hand-off to launch: [frontend-plan.md](frontend-plan.md).

---

## Risks

Risks 1, 3, 4, 5, 7 and 8 belong to the mobile scope; 2 and 6 apply from day one.

1. **The map in a webview.** The one thing that could invalidate the Capacitor half — so it is the
   **first step of the mobile scope**, before any native work (on the web it's ordinary MapLibre,
   checked in web phase 3.4). Spike: map screen with ~300 clustered pins in a Capacitor build on a
   Redmi A3-class phone (3–4 GB RAM) over real 4G. It tests sustained memory (WebGL + tile cache +
   WhatsApp running), cold Protomaps range requests, and whether the OS reclaims the webview in the
   background. **Pass:** stable memory over five minutes of panning, no reload after backgrounding,
   cold map interactive under ~2 s. **Fail:** a native map view under the webview via plugin (a
   rescue, not a plan), or reopen the native question with evidence. The web is unaffected.
2. **Client/server rule drift.** Managed by Rule 2: generated contracts + transition-table contract
   tests before the second vertical.
3. **Apple guideline 4.2** ("just a website"). Defence by construction: native push, camera, native
   geolocation, native share, offline shell, native sign-in — and by then, an app with real usage.
4. **Live updates are not free.** Capgo or Capawesome, ~USD 10/mo once the apps exist. Native or
   plugin changes still need a store release.
5. **Webview polish.** Safe areas, system bars, keyboard avoidance, Android back button, overscroll,
   long-press selection. None hard; together they are "an app" vs "a website in a box". A full day
   inside the mobile scope, spent before the stores — living with the rough version normalizes it.
6. **Sightings on bad connectivity.** «Lo vi» is sent outdoors, one-handed, on weak signal, by
   someone with no account and no reason to retry. It is the one mutation with a **persisted retry
   queue** from day one (TanStack Query mutation defaults + persister). General offline stays out.
7. **Google sign-in inside a webview.** Google blocks OAuth in embedded webviews
   (`disallowed_useragent`), so the store apps use a native sign-in plugin behind
   `src/platform/auth`. Solved, but it is per-platform code to test on real devices.
8. **Two store reviews in the loop.** Every native change waits on Apple and Google. Kept small by
   the rule that the web never waits for the stores, and by live updates for everything else.

## Escape hatches

**If a real server is needed** (SSR for the feed, say): **TanStack Start** — TanStack Router with a
server attached. Same routes, components and data layer; nothing to un-export.

**If the webview ceiling is reached** (the map spike fails, or push-driven retention becomes the
main loop and app feel costs users): **React Native**, rewriting `routes`, `features` components and
`ui`. `domain`, `contracts` and `api-client` are untouched — roughly the complexity of docs 04–07,
written and tested once. That boundary is what makes today's decision reversible.

## Open

Tracked in [open-items](../open-items.md): O10 (`og:image` renderer), O12 (session transport),
O13 (app links), O14 (API spec + contract generation).
