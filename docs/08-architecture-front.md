# Architecture — Web & Mobile

> How the client side is built. Backend, database and infrastructure are deliberately out of scope
> here; this document covers the app, the store builds, and the rules that keep them one thing.
> Decided 2026-08-23. Same convention as the rest: identifiers English/snake_case, Spanish strings
> are UI copy.

## The decision in one line

**One codebase, three targets.** A React web app that runs on the web, and the *same* build wrapped
by **Capacitor** into iOS and Android store apps. Screens are written once. The only per-platform
code is a thin adapter layer for push, camera, location and the share sheet.

> Reverses the Next.js + Expo split recorded earlier the same day. That approach was correct about
> the tradeoffs and wrong about the price: two UIs forever, paid by two people at ~15 hrs/week
> combined, to buy a native-feeling app for a product whose growth loop is entirely web.

## What this buys, concretely

| | Next.js + Expo | **Capacitor** |
|---|---|---|
| Screens written | Twice | **Once** |
| The map | MapLibre GL JS *and* a native SDK | **MapLibre GL JS. One implementation.** |
| Design system | shadcn on web, NativeWind on native | **shadcn everywhere** |
| Repo | Monorepo, 2 apps, 5 packages | **One app, folders** |
| Store apps | Genuinely native | Webview |
| OTA updates | Free with EAS Update | Needs Capgo, or a remote shell |

The map row is the one that changed the decision. Under the Expo split, the single most complex
screen in the product had to be built and maintained twice, in two different libraries, with two sets
of bugs. Under Capacitor there is one map, and it is the same MapLibre GL JS instance everywhere.

## What it costs

**The store apps run in a webview.** Scroll physics, keyboard behaviour and navigation transitions
read as web unless deliberately tuned. And the map — WebGL inside a webview — is the open question,
addressed below as the first thing to build.

This is a real tradeoff and it is being taken with open eyes. The reasoning: our users are on
Android, arriving from WhatsApp links, using the product in short urgent bursts. Nobody opens a
lost-pet app to admire the scroll physics.

---

## The two build targets

This is the one genuine integration cost of Capacitor + Next.js, and it needs to be understood before
the first route is written.

**Next.js server rendering does not run inside Capacitor.** The store build has to be static assets
the webview loads locally. So:

```
next build                    → Vercel        → the web app
next build (output: export)   → out/          → Capacitor → ios/ + android/
```

### Rule: the app is a static SPA; one function owns the share page

The entire Next.js app is built with `output: 'export'` — a pure client-rendered SPA, identical on
web and inside the store apps. No divergence, no conditional routes, no second build config.

The one thing that genuinely needs a server is the WhatsApp link preview, and it needs it for
exactly one route:

```
/p/[caseId]   → a Vercel serverless function
                → renders real HTML: OG tags, the pet photo via @vercel/og, a readable summary
                → then hands off to the SPA
```

That function is ~100 lines and it protects the entire growth loop: a stranger opening a shared link
gets a correct preview in WhatsApp, real HTML for the crawler, and a fast first paint before any
JavaScript runs.

**Everything else is client-rendered**, including the public feed and map. Those aren't link-preview
targets — they just need to be fast, and a cached shell plus a client fetch is fast enough.

> If SPA first paint on the public feed turns out to be too slow for strangers on 4G, the escape is
> to promote the web build to full SSR and keep the static export as a second app. Because both are
> React DOM, **every component moves verbatim** — that migration duplicates nothing. It is nothing
> like the Expo split it replaces.

---

## The architecture

Four layers. Dependencies point inward, always.

```
app/                     routes and screens — one implementation
   └─ src/features       hooks and components — the product
        └─ src/api-client  fetch + TanStack Query
             └─ src/domain  pure rules — zero dependencies
                  ↑
        src/platform    ← adapters: push, location, camera, share
```

### Rule 1 — `domain` imports nothing

Not React, not fetch, not Zod. Plain TypeScript functions over plain data. This is what makes the
four case lifecycles testable in milliseconds, and what makes them survive if this whole document is
thrown away and rewritten for React Native in a year.

Enforced in CI with `dependency-cruiser`, because a dependency rule living in a README is a
suggestion.

| Layer | May import |
|---|---|
| `domain` | nothing |
| `contracts` | zod |
| `api-client` | `contracts` |
| `features` | `domain`, `contracts`, `api-client`, `ui`, `platform`, react |
| `app/` | everything above |

### Rule 2 — platform capabilities go through `src/platform`

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

Four or five modules total — `location`, `camera`, `share`, `push`, `storage`. Everything above them
is written once and never asks where it's running.

This is also what keeps the door open: if the app is ever rebuilt in React Native, these modules are
the only files that get replaced.

### Rule 3 — the map lives behind one component

`src/ui/Map/` exposes a props interface and nothing else. Markers are GL symbol layers, never DOM
elements — a few hundred DOM pins will crawl in a desktop browser too, and blaming the webview for
that is the classic misdiagnosis.

The map is the most likely thing in this codebase to be swapped, for cost, for performance, or for a
native rebuild. It gets a boundary from day one.

---

## State machines

The four case lifecycles in [04](04-lost-workflow_draft_1.md)–[07](07-help-workflow.md) are already
drawn as state machines. They get transcribed into `src/domain`, one file each, as discriminated
unions plus a pure `transition()`:

```ts
// src/domain/lost/machine.ts
type Status = 'active' | 'reunited' | 'expired' | 'cancelled'

type Event =
  | { type: 'OWNER_CONFIRMS_REUNION' }
  | { type: 'CHECKIN_UNANSWERED'; consecutive: number }
  | { type: 'OWNER_REOPENS'; daysSinceExpiry: number }

export function transition(status: Status, event: Event): Status | null {
  if (status === 'active' && event.type === 'OWNER_CONFIRMS_REUNION') return 'reunited'
  if (status === 'active' && event.type === 'CHECKIN_UNANSWERED')
    return event.consecutive >= 2 ? 'expired' : 'active'
  if (status === 'expired' && event.type === 'OWNER_REOPENS')
    return event.daysSinceExpiry <= 30 ? 'active' : null
  return null   // illegal transition
}
```

**Why this and not scattered conditionals.** Without it, "only the owner closes a case as reunited"
lives in a button's `onClick`, in the check-in job, and in the API handler. Three copies, and the
moderation panel someone builds in month three will quietly violate all of them. One function, and
the rule in the doc and the rule in the code cannot drift apart.

**Not XState.** These machines are small and flat, with no parallel states or actors. Revisit if one
grows nested states.

---

## Folder structure

```
scuby/
├── app/                            Next.js App Router — output: export
│   ├── (public)/                   no session
│   │   ├── p/[caseId]/             the SPA view of a shared case
│   │   ├── feed/
│   │   └── mapa/
│   ├── (app)/                      session required
│   │   ├── publicar/
│   │   ├── mis-casos/
│   │   └── bandeja/
│   └── layout.tsx
│
├── src/
│   ├── domain/                     ← pure. zero dependencies.
│   │   ├── lost/       machine.ts · checkin.ts · rules.ts
│   │   ├── found/      machine.ts · clocks.ts · evidence.ts
│   │   ├── adoption/   machine.ts · reservation.ts
│   │   ├── help/       machine.ts · ledger.ts
│   │   └── shared/     checkin.ts · report.ts · identity.ts
│   ├── contracts/                  Zod schemas
│   ├── api-client/
│   │   └── queries/                TanStack Query hooks
│   ├── features/
│   │   └── lost/  found/  adoption/  help/
│   ├── ui/                         shadcn + Map/ + tokens
│   └── platform/                   location · camera · share · push · storage
│
├── api/
│   └── p/[caseId].ts               Vercel function — OG meta + @vercel/og image
│
├── ios/                            generated by Capacitor
├── android/                        generated by Capacitor
├── capacitor.config.ts
└── docs/                           00–08
```

Feature folders, not type folders. `src/features/lost/` beats `hooks/`, `screens/`, `utils/` the
moment there are four verticals.

**No monorepo, no workspaces, no Turborepo.** There is one deployable and one app; folders are
enough. Introduce workspaces only if the web build is ever promoted to SSR as a second app — and not
a day earlier.

---

## Stack

### App

| | |
|---|---|
| Framework | **Next.js 15** App Router, `output: 'export'`, React 19 |
| Styling | **Tailwind + shadcn/ui** — the full library, no native compromise |
| Map | **MapLibre GL JS** + **Protomaps** tiles — GL symbol layers, never DOM markers |
| Server state | **TanStack Query** |
| Forms | **react-hook-form + Zod** — these four flows are mostly forms |
| Web push / PWA | **Serwist** — service worker, installable, Web Push on Android |
| Deploy | **Vercel** |

### Native shell

| | |
|---|---|
| Wrapper | **Capacitor** |
| Plugins | `push-notifications` · `geolocation` · `camera` · `share` · `app` (deep links) · `status-bar` · `keyboard` · `preferences` |
| Share preview | **`@vercel/og`** in the `/p/[caseId]` function |
| Live updates | **Capgo**, or point the shell at a remote URL. Not free like EAS Update — see the risks |

### Tooling

**TypeScript** strict · **Biome** instead of ESLint + Prettier · **`dependency-cruiser`** for the
layer rule · **Vitest** on `domain` · **Playwright** for web e2e.

---

## Risks, and what to do about each

### 1. The map in a webview — build it first

The one thing that could invalidate this decision. It gets built in week one, before anything else.

**The spike:** the map screen with ~300 clustered pins, running in a Capacitor build on a
Redmi A3-class Android — 3–4 GB RAM, over 4G. Not a simulator, not a laptop.

**Pass:** smooth pinch-zoom with no visible jank, stable memory across several minutes of panning,
cold map load under ~2s.

**If it fails:** the fallback is a native map view under the webview via a Capacitor plugin (real
z-index and overlay friction — a rescue, not a plan), or reopening the Expo decision with actual
evidence instead of speculation.

### 2. Apple Guideline 4.2 — "minimum functionality"

Apple rejects apps that are a website in a shell with no native value. Worth knowing before
submission, not after.

Our defence is genuine and should be visible in the build: **native push notifications** (the
product's differentiator), camera capture for pet photos, native geolocation, and an offline shell.
An app that only renders remote pages is the one that gets rejected.

### 3. No free OTA updates

EAS Update ships JS fixes past store review for free; Capacitor doesn't. Options: **Capgo** (open
source, paid hosting or self-host), Ionic Appflow (paid), or configure the shell to load a remote
URL and accept the network dependency.

Budget this. At 15 hrs/week, "wait five days for review to fix a typo" is a real cost.

### 4. Webview polish is underestimated

Safe areas, status bar colour, keyboard avoidance, the Android hardware back button, disabling
overscroll bounce, and hiding the text-selection long-press. None is hard; together they are the
difference between "an app" and "a website in a box", and they are invisible until you're holding a
phone.

Budget a full day, and do it early — living with the rough version for months normalizes it.

---

## Decision log

| # | Decision | Chosen | Rejected & why |
|---|---|---|---|
| 1 | Cross-platform shape | **Capacitor over one React codebase** | Next.js + Expo (two UIs and two map implementations, forever, at 15 hrs/week); Expo universal (weak SSR/OG on the surface the growth loop runs through); Flutter (discards the ecosystem entirely) |
| 2 | Build targets | Static export everywhere + one server function for `/p/[caseId]` | Dual Next configs with filtered routes (config complexity for one route's benefit); full SSR with a remote-URL shell (network dependency, more App Store scrutiny) |
| 3 | Repo layout | **One app, folders** | Monorepo — one deployable doesn't need workspaces, and the tooling is a permanent tax |
| 4 | Platform access | One adapter module per capability in `src/platform` | Plugin imports scattered through features, which is what makes a future framework change a rewrite |
| 5 | State machines | Discriminated unions + pure `transition()` | XState (no parallel states or actors to justify it); scattered conditionals (copies that drift) |
| 6 | Map vendor | MapLibre + Protomaps | Google Maps and Mapbox both bill per load, and this map is opened constantly by strangers who never sign up |
| 7 | Linting | Biome | ESLint + Prettier — two tools, slower, more config, no benefit at this size |

---

## Decisions still open — binding

Expensive to change later. Take them before the first feature.

| # | Question | Why it can't wait |
|---|---|---|
| 1 | **Universal Links / App Links** | `scuby.co/p/abc` must open the app when installed. Touches the domain, `capacitor.config.ts`, and iOS entitlements — retrofitting means every link already shared on WhatsApp behaves differently from new ones |
| 2 | **Session transport: cookie or token?** | The web wants httpOnly cookies; the Capacitor webview is on a different origin and wants a token in `Preferences`. One issuer, two transports, decided up front |
| 3 | **Where analytics events are emitted** | The event names are already fixed in [04](04-lost-workflow_draft_1.md)–[07](07-help-workflow.md). Emit from `features`, never from components |
| 4 | **Push registration: one abstraction or two?** | Web Push (VAPID) and FCM/APNs have different token shapes and lifecycles. The server needs one device table that holds both from the start |

## Decisions deferred — on purpose

Offline queue for sightings (Colombian connectivity argues for it; measure first) · pin clustering
client-side vs server-side · image pipeline and sizes for low-end Android · feature flags · test depth
beyond `domain`.

## The escape hatch

If the webview ceiling is genuinely reached — the map spike fails, or push-driven retention becomes
the main loop and the app feel starts costing users — the exit is React Native, and the cost is
rewriting `app/`, `src/features` components and `src/ui`.

`src/domain`, `src/contracts` and `src/api-client` are untouched. That is roughly the complexity of
docs 04–07, written and tested once. That boundary is the whole reason it exists, and it is what
makes today's decision reversible rather than permanent.
