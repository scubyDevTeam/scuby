# Architecture — Web & Mobile

> How the client side is built. Backend, database and infrastructure are deliberately out of scope
> here; this document covers the two apps, what they share, and the rules that keep the sharing from
> rotting.
> Decided 2026-08-23. Same convention as the rest: identifiers English/snake_case, Spanish strings
> are UI copy.

## The decision in one line

**Two apps, one brain.** `apps/web` in Next.js and `apps/mobile` in Expo, both sitting on shared
packages that hold every rule from [04](04-lost-workflow_draft_1.md)–[07](07-help-workflow.md).
Presentation is written twice on purpose. Logic is written once, on principle.

## Why not one universal codebase

The obvious move is React Native Web through Expo Router — one codebase, three targets. It loses on a
constraint that comes from the product, not from taste:

> The growth engine is a WhatsApp share opening for a **stranger** who never installs anything,
> on a cheap Android, over 4G, and then drops a pin.

That path needs server-rendered HTML, correct Open Graph tags per case, and a fast first paint.
Server rendering and link previews are exactly where React Native Web is weakest, and the surface it
would degrade is the one the whole Phase 1 loop runs through.

The counter-argument — "but then the map is written twice" — doesn't survive contact with the detail:

> **The map is platform-specific in every option on the table.** MapLibre GL JS on web, a native map
> SDK on native. That's true for Expo universal, for Capacitor, for Solito, for anything.

Same for push registration, camera, and the share sheet. So "one UI codebase" was never going to
cover the hard parts anyway. What it *would* have covered — forms, feeds, an inbox — is the cheap
half.

| Rejected | Why |
|---|---|
| **Expo universal** (RNW for web too) | Weak SSR/OG on the surface the growth loop depends on; heavier JS on the devices our users actually have |
| **Capacitor** (wrap the web app) | One codebase and genuinely tempting, but the map — a core screen — runs in a webview on low-end Android. Viable; see [the escape hatch](#if-the-two-uis-become-too-expensive) |
| **Solito** (Next + Expo sharing RNW components) | One UI tree with real SSR, but two routers to keep in sync and RNW styling constraints. The tax outruns the benefit at this team size |
| **Flutter** | Discards the React/TypeScript ecosystem and every shared-logic argument below |

### The cost, stated plainly

Screens are written twice, forever. That is the price, it is real, and it is paid in the cheapest
part of the codebase. What it buys is a web app with no compromises on the one surface that acquires
users, and a mobile app with no compromises on the one screen that retains them.

---

## The architecture

Four layers. Dependencies point inward, always.

```
apps (web | mobile)      presentation — two implementations
   └─ features           hooks, no JSX — shared
        └─ api-client    fetch + TanStack Query — shared
             └─ domain   pure rules — shared, zero dependencies
```

### Rule 1 — headless hooks, flat views

Behaviour lives in `packages/features` as hooks that return data and callbacks. Each app renders
them. `useSightingForm()` is written once and painted twice.

```ts
// packages/features/lost/use-sighting-form.ts   ← shared
// apps/web/app/(public)/p/[caseId]/sighting-form.tsx     ← 40 lines of JSX
// apps/mobile/app/caso/[id]/sighting-form.tsx            ← 40 lines of JSX
```

`packages/features` contains **no JSX, ever**. Not a component, not a fragment. The moment it does,
one app starts winning and the package stops being shared.

### Rule 2 — ports and injection

Anything platform-specific is received, never imported:

```ts
useSightingForm({ getLocation })
// apps/web    → navigator.geolocation
// apps/mobile → expo-location
```

Same for camera, share sheet, push registration and secure storage. The hook is then testable with a
stub instead of a platform mock, which is most of why the pattern earns its place.

### Rule 3 — `domain` imports nothing

Not React, not fetch, not even Zod. It is plain TypeScript functions over plain data. That is what
makes it survive a framework change, and what lets it run in a test in under a millisecond.

Enforced in CI with `dependency-cruiser`, because a dependency rule that lives in a README is a
suggestion.

| Package | May import |
|---|---|
| `domain` | nothing |
| `contracts` | zod |
| `api-client` | `contracts` |
| `features` | `domain`, `contracts`, `api-client`, react |
| `apps/*` | everything above — **never each other** |

---

## State machines

The four case lifecycles in [04](04-lost-workflow_draft_1.md)–[07](07-help-workflow.md) are already
drawn as state machines. They get transcribed into `domain`, one file each, as discriminated unions
plus a pure `transition()`:

```ts
// packages/domain/lost/machine.ts
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

**Why this and not scattered `if`s.** Without it, "only the owner closes a case as reunited" lives in
a button's `onClick` on web, the same button on mobile, the check-in cron, and the API handler. Four
copies, and the moderation panel someone builds in month three will quietly violate all of them. One
function, and the rule in the doc and the rule in the code cannot drift apart.

**Not XState.** These machines are small, flat, and have no parallel states or actors. XState pays
for itself when they do; here it would be ceremony. Revisit if a machine grows nested states.

---

## Folder structure

```
scuby/
├── apps/
│   ├── web/
│   │   ├── app/
│   │   │   ├── (public)/                 no session — the WhatsApp loop
│   │   │   │   ├── p/[caseId]/           shareable card · SSR + OG
│   │   │   │   ├── mapa/
│   │   │   │   └── feed/
│   │   │   ├── (app)/                    session required
│   │   │   │   ├── publicar/
│   │   │   │   ├── mis-casos/
│   │   │   │   └── bandeja/
│   │   │   └── api/
│   │   ├── components/                   web-only
│   │   └── lib/
│   │
│   └── mobile/
│       ├── app/                          Expo Router
│       │   ├── (tabs)/
│       │   ├── caso/[id].tsx
│       │   └── _layout.tsx
│       ├── components/                   native-only
│       └── app.config.ts
│
├── packages/
│   ├── domain/
│   │   ├── lost/       machine.ts · checkin.ts · rules.ts
│   │   ├── found/      machine.ts · clocks.ts · evidence.ts
│   │   ├── adoption/   machine.ts · reservation.ts
│   │   ├── help/       machine.ts · ledger.ts
│   │   └── shared/     checkin.ts · report.ts · identity.ts
│   ├── contracts/                        Zod schemas
│   ├── api-client/
│   │   └── queries/                      TanStack Query hooks
│   ├── features/
│   │   └── lost/  found/  adoption/  help/
│   ├── tokens/                           color · spacing · type
│   └── config/                           tsconfig · biome · tailwind preset
│
├── supabase/
└── docs/                                 00–08
```

Feature folders, not type folders. `packages/features/lost/` beats `hooks/`, `screens/`, `utils/` the
moment there are four verticals.

---

## Stack

### Web — `apps/web`

| | |
|---|---|
| Framework | **Next.js 15** App Router, React 19, RSC |
| Styling | **Tailwind + shadcn/ui** |
| Map | **MapLibre GL JS** + **Protomaps** tiles — markers as GL symbol layers, never DOM |
| Share cards | **`@vercel/og`** — the WhatsApp preview per case |
| PWA / push | **Serwist** — service worker, installable, Web Push on Android |
| Deploy | **Vercel** |

### Mobile — `apps/mobile`

| | |
|---|---|
| Framework | **Expo** + **Expo Router** |
| Styling | **NativeWind** |
| Map | **`@rnmapbox/maps`** — same Protomaps tiles |
| Device | `expo-notifications` · `expo-location` · `expo-image` · `expo-camera` |
| Ship | **EAS Build + EAS Update** — OTA fixes without store review |

### Shared

**TypeScript** strict · **Zod** (one definition per shape) · **TanStack Query** (server state) ·
**react-hook-form** (these flows are mostly forms) · state machines as discriminated unions.

### Monorepo

**pnpm workspaces + Turborepo**, and nothing else. **Not Nx** — its generators and config layer solve
problems that start at ten packages, not five.

**Biome** replaces ESLint + Prettier. **`dependency-cruiser`** enforces the layer rule in CI.
**Vitest** on `domain`, **Playwright** on web, **Maestro** on mobile.

> **Do the Metro monorepo config on day one**, before there is any code. Metro's `node_modules`
> resolution across workspace packages is the single most common source of "builds on web, breaks on
> mobile," and discovering it in month three costs ten times more than configuring it in hour one.
> `create-t3-turbo` is the canonical reference for exactly this pair.

---

## Decision log

| # | Decision | Chosen | Rejected & why |
|---|---|---|---|
| 1 | Cross-platform shape | Next.js + Expo, shared logic packages | Expo universal (weak SSR/OG on the growth surface); Capacitor (webview map on low-end Android); Solito (two routers, RNW styling tax); Flutter (discards the ecosystem) |
| 2 | Repo layout | **Monorepo**, pnpm + Turborepo | Separate repos — sharing `domain` would mean publishing and versioning npm packages between two people |
| 3 | Monorepo tooling | pnpm workspaces + Turborepo | Nx (config surface without the scale to justify it); bare npm workspaces (no task graph, no cache) |
| 4 | Shared-logic boundary | Hooks with no JSX, in `packages/features` | Shared components via react-native-web — the thing that makes universal codebases rot |
| 5 | Platform capabilities | Injected ports | Direct imports behind `Platform.OS` branches, which accumulate until the file is unreadable |
| 6 | State machines | Discriminated unions + pure `transition()` | XState — no parallel states or actors to justify it; scattered conditionals — four drifting copies |
| 7 | Map vendor | MapLibre + Protomaps | Google Maps and Mapbox both bill per load, and this map is opened constantly by strangers who never sign up |
| 8 | Linting | Biome | ESLint + Prettier — two tools, slower, more config, no benefit at this size |

---

## Decisions still open — binding

These are expensive to change later. Take them before the first feature.

| # | Question | Why it can't wait |
|---|---|---|
| 1 | **Shared API, or Next.js Server Actions?** | If business logic lives in Server Actions, mobile can't call it and everything gets written twice. Recommended: one typed API that **web also consumes**; Server Actions only for web-exclusive concerns |
| 2 | **Universal Links / App Links** | `scuby.co/p/abc` must open the app when installed. It touches the domain, `app.config.ts` and iOS entitlements — and retrofitting it means every link already shared on WhatsApp behaves differently from new ones |
| 3 | **Session transport: cookie or token?** | Web wants httpOnly cookies, mobile wants SecureStore. One issuer, two transports, decided up front |
| 4 | **Design system: shared tokens or universal components?** | Tokens + shadcn/NativeWind (two implementations) vs Tamagui (one). Switching to Tamagui later is a UI rewrite |
| 5 | **Where analytics events are emitted** | The event names are already fixed in [04](04-lost-workflow_draft_1.md)–[07](07-help-workflow.md). Emit from `features`, not components — otherwise each UI emits them slightly differently and the metrics stop being comparable |

## Decisions deferred — on purpose

Offline queue for sightings (Colombian connectivity argues for it; measure before building) · pin
clustering client-side vs server-side · image pipeline and sizes for low-end Android · API versioning
against EAS Update, which leaves old clients alive in the wild · feature flags · test depth beyond
`domain`.

## If the two UIs become too expensive

The escape hatch is **Capacitor**: wrap `apps/web` into a store build and drop `apps/mobile`. It costs
the native map and the native feel, and it recovers roughly half the client-side work. The signal to
consider it is honest and specific — mobile screens consistently lagging web by more than a release,
with no user-visible reason for the app to be native beyond push.

Whichever way that goes, `packages/domain` and `packages/contracts` are untouched. That is the entire
point of the boundary.
