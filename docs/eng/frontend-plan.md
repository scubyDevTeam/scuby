# Frontend Build Plan — Step by Step

> The runbook for building the client from zero, starting from a design made in Claude Design.
> Two scopes ([00 · #20](../product/00-product-map.md)): **scope 1, the web + PWA**, is the launch;
> **scope 2, mobile** (Play Store + App Store via Capacitor), is a planned medium-term scope at the
> end of this doc. **What** we build and **why** live in [frontend.md](frontend.md) and the product
> docs; this doc only orders the work. Written 2026-10-05. Frontend only — the backend appears as
> mocks (MSW) until phase 5.

## How to use this doc

- **One step = one branch = one PR.** Branch name `fe/<step>-<slug>` (e.g. `fe/0.3-router-msw`).
  Steps are sized for one or two Claude Code sessions.
- **Every step has the same shape:** *Read* (the docs that own the behavior), *Do*, *Done when*
  (checkable), and for the key steps a *Prompt* to start the Claude Code session. Start each session
  in **plan mode** with that prompt; approve the plan; then let it implement.
- **Docs win on behavior, the design wins on visuals.** When the design and a doc disagree on what
  a screen does, the doc wins and the design gets fixed. When a step forces a new decision, it lands
  in the owning doc and the decision log in the same PR (repo rule 2).
- **Models in Claude Code** (`/model`): Opus 5.5 by default. Fable 5.1 for steps marked ★
  (architecture, native, hard debugging). Sonnet 5.5 for steps marked ◇ (repetitive UI from an
  already-set pattern).
- **Global definition of done** for every PR: the feature has its unit tests and its happy-path
  e2e ([frontend.md](frontend.md) · Testing); CI green (lint, types, tests, e2e, layer rule, size
  budget); new screens compared side by side with the design; no doc contradicted.

## Map

**Scope 1 — Web + PWA (the launch)**

| Phase | What | Needs backend? |
|---|---|---|
| P | Prerequisites: accounts, tools, open decisions | No |
| D | Design in Claude Design → inventory and gaps | No |
| 0 | Scaffold `web/`, languages in the URL | No |
| 1 | Domain (rules as pure code) | No |
| 2 | Case page `/c/:code` + WhatsApp preview | No |
| 3 | Map + feed | No |
| 4 | Helper actions without an account | No |
| 5 | Auth + owner publishing | **Yes** |
| 6 | Found | Yes |
| 7 | Web launch | Yes |
| 8 | Adoption, then Help | Yes |

**Scope 2 — Mobile (medium term):** M.0–M.12, at the end.

---

## Phase P — Prerequisites (no code)

### P.1 Accounts
- GitHub access to the repo (CLAUDE.md rule 7).
- **Vercel** project (root directory `web/`) and a **Sentry** project.
- Domain `scuby.co` with DNS access.
- Store accounts wait for the mobile scope (M.1).

### P.2 Local tools
- Node (current LTS) + **pnpm**.
- **The reference device:** a Redmi A3-class Android (3–4 GB RAM) with a real prepaid SIM. Every
  performance check in this plan runs on it, in Chrome — not on a laptop.

### P.3 Decisions to close before code
The product name is **not** one of them: it is configuration ([00 · #21](../product/00-product-map.md)), open as [O16](../open-items.md). Design and code use the working name «Scuby».

| Decision | Proposal | Lands in |
|---|---|---|
| Tile source for the map — **closed for development** *(2026-10-13)*: OpenFreeMap, keyless. Still open for production | OpenFreeMap, Protomaps hosted API, or a self-hosted `.pmtiles` file on object storage — pick with real traffic | [frontend.md](frontend.md) · Stack, [costs.md](costs.md) |

---

## Phase D — Design (Claude Design → code)

### D.1 Produce the design in Claude Design
Create a **design system** and a **design** in Claude Design using the brief below. Feed it
`docs/pdv.html` as a visual reference if the team likes that direction.

**Design brief — paste into Claude Design (UI copy is Spanish):**

> Diseña la web app **Scuby** (nombre provisional — trátalo como un texto reemplazable, no lo
> integres en el logo ni en ilustraciones) (mascotas perdidas, encontradas, adopción y ayuda en Colombia).
> Mobile-first a **360 px** de ancho; también debe verse bien en escritorio (una columna centrada).
> Más adelante se empaquetará como app de tienda, así que deja espacio para las áreas seguras del
> celular. Usuarios en Android de gama baja, con datos prepago, que llegan desde un link de WhatsApp
> y usan la app en momentos de urgencia: contraste alto, objetivos táctiles ≥ 44 px, texto ≥ 16 px,
> una acción principal por pantalla. Todo el texto en español de Colombia, tono cálido y directo.
>
> **Sistema de diseño:** paleta (primario, superficies, texto, estados: éxito/alerta/error, y un
> color por vertical: perdido, encontrado, adopción, ayuda), tipografía (2 familias máximo, con
> licencia para empaquetar — el afiche las usa sin conexión), espaciado, radios, sombras, iconos.
> Componentes: botón (primario, secundario, fantasma, destructivo), campo de texto, campo de
> teléfono con prefijo de país, selector de chips, hoja inferior (bottom sheet), tarjeta de caso,
> banner de estado, badge, avatar, barra de acciones fija abajo, toast, estado vacío, esqueleto de
> carga.
>
> **Pantallas (cada una con sus estados: cargando, vacío, error):**
> 1. **Caso perdido** (`/c/CODIGO`), en 4 estados: activo, «¡Ya está en casa!», archivado, ya no
>    disponible. Foto, nombre, especie, zona (barrio), fecha, descripción, mapa con área y
>    avistamientos, acciones: «Lo vi», «Lo tengo», «Compartir», «Reportar».
> 2. **Caso encontrado**, mismos estados, acción principal «Es mío».
> 3. **Inicio / feed** con mapa y lista, filtros por tipo y especie, vacío local → nacional.
> 4. **«Lo vi»** (hoja inferior): marcar punto en el mapa, cuándo, foto opcional, contacto opcional.
> 5. **«Lo tengo» / «Es mío»**: teléfono obligatorio, mensaje, foto de prueba.
> 6. **Ingresar** (hoja inferior): Google, o correo → código de 6 dígitos.
> 7. **Publicar perdido** (formulario en pasos): mascota, fotos, zona en el mapa con radio, fecha,
>    descripción, contacto, paso de teléfono con código SMS.
> 8. **Vista del dueño de su caso**: posibles hallazgos («Abrir WhatsApp», «Llamar»), avistamientos,
>    pregunta de seguimiento «¿Sigue perdida?», cerrar como reunida.
> 9. **Afiche** para compartir, en 3 formatos (historia 9:16, cuadrado, imprimible A4), con QR.
> 10. **Mis casos**, **Bandeja** (avisos dentro de la app), **Perfil**.
> 11. **Reportar** (hoja inferior con motivos).
> 12. **Aviso para iPhone**: «Para recibir avisos, añade Scuby a tu pantalla de inicio».
> 13. Ícono de la app (PWA) y pantalla de carga.

### D.2 Hand the design to Claude Code ★
Paste the Claude Design links (the design and the design system) into a Claude Code session.
Claude Code reads them with its Artifact tool. Output: **`web/design/inventory.md`**, containing:
- **Screens** — design link · route · feature folder · owning doc section.
- **Components** — each one mapped to a shadcn base or marked custom.
- **Tokens** — colors, type scale, spacing, radii, shadows, as a table.
- **Gaps** — every screen checked against its UI contract (CLAUDE.md rule 3: publish flows =
  [auth.md](auth.md) phone step + the vertical's *Publishing*; maps = [04](../product/04-lost-workflow.md)
  display rules + location precision; cards/posters = [10](../product/10-sharing.md); copy =
  [08](../product/08-notifications.md)). Missing states, contradicted rules, missing screens.

**Prompt:** «Lee el diseño y el design system de Claude Design en estos links: <links>. Crea
`web/design/inventory.md` según `docs/eng/frontend-plan.md` paso D.2. Revisa cada pantalla contra
el contrato de UI de su doc (regla 3 de CLAUDE.md) y lista los gaps. No escribas código todavía.»

### D.3 Close the gaps
Fix gaps in Claude Design (visuals, missing states) or in the docs (behavior), then re-run D.2's
gap check. **Done when** the gap list is empty or every remaining gap has an owner and a step.

Token translation into code happens in step 0.4, once there is a project to put it in.

---

## Phase 0 — Scaffold

### 0.1 Project ★
**Read:** [frontend.md](frontend.md) · Stack, Folder structure.
**Do:** `web/` with Vite + React 19 + TypeScript strict, pnpm, path aliases per layer, the folder
skeleton from frontend.md (empty `index.ts` per layer; no `android/`/`ios/` yet), `.nvmrc`,
`src/brand.ts` (frontend.md · What the frontend owns — Product name), and `web/.env` with a mock
value for every key the client will need, read only through `src/env.ts`.
**Done when:** `pnpm dev` and `pnpm build` work; the tree matches frontend.md.
**Prompt:** «Paso 0.1 de `docs/eng/frontend-plan.md`. Crea `web/` siguiendo Stack y Folder
structure de `docs/eng/frontend.md` (alcance 1, sin Capacitor). Fija la versión mayor actual de
cada dependencia.»

### 0.2 Quality gates
**Do:** Biome; Vitest; **dependency-cruiser** with the layer table from frontend.md
(`domain` imports nothing, etc.); Playwright; Lighthouse CI config; GitHub Actions workflow running lint → typecheck →
test → build → depcruise on every PR.
**Done when:** each gate goes red on a deliberate violation (commit one, watch it fail, revert).

### 0.3 Router, data layer, mocks
**Read:** [frontend.md](frontend.md) · Architecture; `web/design/inventory.md` (routes).
**Do:** TanStack Router file routes for every route in the inventory (placeholder screens);
`_auth/` layout guard (stubbed session); TanStack Query client; **MSW** in dev and preview builds,
switched by `VITE_API_MOCK`; `api-client` fetch wrapper with typed errors.
**Done when:** every inventory route renders its placeholder; one MSW-backed query works end to end.

### 0.4 Design system in code ◇
**Read:** `web/design/inventory.md` · Tokens, Components.
**Do:** Tailwind + shadcn init; tokens as CSS variables in `src/ui/tokens.css` wired into the
Tailwind theme and shadcn's variables; **fonts self-hosted** (bundled, not a CDN — the poster and
the offline shell need them); every inventory component built or themed in `src/ui/`; a dev-only
`/dev/ui` gallery route rendering all of them.
**Done when:** the gallery matches the design system side by side; dev-only routes are excluded
from production builds.
**Prompt:** «Paso 0.4. Traduce los tokens y componentes de `web/design/inventory.md` a
`src/ui/` con Tailwind + shadcn. Crea la galería `/dev/ui`. Compárala con el design system de
Claude Design: <link>.»

### 0.5 PWA, errors, deploy
**Do:** vite-plugin-pwa (manifest with the design's icons, SW caching shell + fonts); Sentry with
sourcemap upload; `vercel.json` with the `/c/:code` rewrite to a stub `api/share.ts`; preview
deploy per PR.
**Done when:** the production URL installs as a PWA on the reference device; a thrown test error
shows in Sentry with a readable stack.

### 0.6 Platform adapters (web branch)
**Read:** [frontend.md](frontend.md) · Rule 4.
**Do:** `src/platform/{location,camera,share,push,storage}` with the **web branch only** and one
shared return type each — the mobile scope adds native branches to these files and nothing else.
Unit tests; a dev-only `/dev/platform` screen to try each capability on the reference device.
**Done when:** every capability works in Chrome on the reference device and in iOS Safari.

### 0.7 `web/CLAUDE.md`
**Do:** short file: commands (dev, test, build, e2e), the layer rule, "docs win on behavior",
pointers to frontend.md and this doc, UI copy in Spanish / identifiers in English, no feature
flags in the client (frontend.md Rule 3), no native APIs outside `src/platform`.
**Done when:** a fresh Claude Code session in `web/` can state the rules without reading frontend.md.

### 0.8 Languages
**Read:** [frontend.md](frontend.md) · Languages; [00 · #25](../product/00-product-map.md).
**Do:** `src/i18n` (language files, `t()`, `rich()`, the provider); every route under the optional
`{-$locale}` segment; every screen's copy as keys in `es.json` with `en.json` beside it;
`Accept-Language` on every request; `pnpm check:copy` in CI; one e2e for the language in the URL.
From here on every feature lands its copy as keys, in both files.
**Done when:** `pnpm check:copy` is green, `/en/…` renders English and `/…` Spanish, and the
locale tests (same keys, placeholders and tags) pass.

---

## Phase 1 — Domain

### 1.1 Entity types
**Read:** [04](../product/04-lost-workflow.md) and [05](../product/05-found-workflow.md) · Entities.
**Do:** Zod schemas + types in `src/contracts/` for pet, lost_case, found_case, sighting,
recovery_claim, ownership_claim, case_checkin, report, and their endpoints in
`src/contracts/api.ts` — the contract the backend implements ([api.md](api.md)). Fixtures covering
**every status** of every case.
**Done when:** fixtures validate against the schemas in a test.

### 1.2 Lost and found machines
**Read:** 04 · Case state machine; 05 · Case state machine, Two clocks.
**Do:** `src/domain/lost/machine.ts`, `src/domain/found/machine.ts` (+ clocks) — discriminated
unions + `transition()`; derived badges as selectors.
**Done when:** every arrow in both docs' diagrams has a test, and so does at least one forbidden
transition per status.

### 1.3 Shared pure rules
**Do:** in `src/domain/shared/`: the 200 m public floor for areas (04 · Location precision), the
sighting distance/time pre-checks (04 · Validation), sighting age bands (04 · Display rules),
phone formatting from a `supported_countries` row ([auth.md](auth.md)).
**Done when:** each rule has table-driven tests citing the doc section in the test name.

---

## Phase 2 — Case page `/c/:code`

### 2.1 Data
**Do:** `useCase(code)` in `api-client`; not-found, purged and network-error states.

### 2.2 Lost case page ◇
**Read:** [10](../product/10-sharing.md) §1 (status table); 04 · Display rules; inventory screen 1.
**Do:** status banner per status; card; photo gallery using image variants; sticky action bar
whose buttons come from `domain` (Rule 2). The map section is a placeholder until phase 3.
**Done when:** all four statuses match the design; the page renders before MapLibre loads.

### 2.3 WhatsApp preview ★
**Read:** [10](../product/10-sharing.md) §2; [frontend.md](frontend.md) · The one server-side thing.
**Do:** `api/share.ts`: fetch the case summary (a JSON fixture behind an env var until the API
exists), inject `og:`/`twitter:` tags + a readable summary into the built `index.html`.
**Done when:** a deployed preview URL pasted into WhatsApp shows title, description and image.

### 2.4 Budgets
**Done when:** Lighthouse CI runs on `/c/:code` (LCP ≤ 2.0 s Slow 4G); there is no size gate.

---

## Phase 3 — Map + feed

### 3.1 `ui/Map` ★
**Read:** [frontend.md](frontend.md) · Rule 5; P.3 tile source.
**Do:** one component, props only (areas, pins with age band, polyline, selection callback),
GL symbol layers, lazy boundary.

### 3.2 Map on the case page
**Read:** 04 · Location precision, Display rules.
**Do:** area with the 200 m floor applied at render, sighting pins by age band, trajectory line.
**Done when:** a fixture with a 50 m area renders as 200 m; the display rules table is honored row
by row.

### 3.3 Feed ◇
**Read:** [00](../product/00-product-map.md) · Geography.
**Do:** `/` with map/list toggle, filters by vertical and species, local-first by optional
geolocation, national fallback when local is empty.
**Done when:** denying location still gives a useful feed.

### 3.4 Performance check
**Do:** a fixture with ~300 pins; five minutes of panning on the reference device in Chrome.
**Done when:** ≤ 2.0 s to interactive tiles on a cold open and no memory climb. Write the numbers
into frontend.md · Risks §1 — they are the baseline the mobile scope's webview spike compares against.

---

## Phase 4 — Helper actions without an account

### 4.1 Image pipeline ★
**Read:** [media-pipeline.md](media-pipeline.md) §1.
**Do:** pick/capture through `platform/camera`; HEIC decode; orientation; downscale ≤ 1600 px;
JPEG ~0.82; upload to a signed URL (MSW); progress, retry, preview kept on failure.
**Done when:** a 12 MP iPhone HEIC arrives as a ~300 KB JPEG with no EXIF (test asserts it).

### 4.2 «Lo vi»
**Read:** 04 · `sighting`, Validation.
**Do:** bottom sheet: pin on the map, `seen_at` defaulting to now, optional photo, optional contact
with the explanatory copy; pre-checks from `domain`; **persisted mutation queue**.
**Done when:** a Playwright test submits offline, closes the tab, reopens online, and the sighting
arrives once.

### 4.3 «Lo tengo»
**Read:** 04 · `recovery_claim` and its rule (claim before channel).
**Do:** phone required, format-validated from `supported_countries`; the claim row is created
before any WhatsApp handoff opens.

### 4.4 Reportar ◇
**Read:** [09](../product/09-reporting.md).
**Do:** one-tap anonymous report sheet on every case and piece of user content.

---

## Phase 5 — Auth + owner publishing (backend needed)

### 5.0 Unblock
**Check before starting:** [O12](../open-items.md) (session transport — for scope 1 the httpOnly
cookie leaning is enough) decided, and a staging API that implements
[openapi.json](openapi.json) ([api.md](api.md) · Plugging in the real backend). Then point the app
at it — `VITE_API_MOCK=false` — and run the e2e suite against it. Add the transition-table contract tests
(frontend.md · Rule 2). Point Lighthouse CI at it too and turn its LCP assertion from `warn` to
`error` (frontend.md · Budgets).

### 5.1 Sign-in ★
**Read:** [auth.md](auth.md) · Sign-in.
**Do:** sign-in sheet opened lazily at the first gated action; Google one-tap and email 6-digit
code.
**Done when:** both doors work on the reference device and on iOS Safari, and a session survives
closing the browser.

### 5.2 Publish a lost case
**Read:** 04 · Publishing; [auth.md](auth.md) · UI contract (phone step).
**Do:** stepped form: pet, photos (4.1), area picker with radius chips, date, description, contact
prefs, phone step rendered only when the response says `phone_step: otp`; reopen offer for an
expired case.

### 5.3 Owner's case view
**Read:** 04 · `recovery_claim`, `case_checkin`, Rule: only the owner closes.
**Do:** claims with «Abrir WhatsApp» / «Llamar» buttons (and the `in_app_only` warning copy),
sighting highlight, check-in answers, close as reunited, cancel.

### 5.4 Poster and sharing ◇
**Read:** [10](../product/10-sharing.md) §3–4.
**Do:** canvas poster in three formats, photo framer, local QR, `document.fonts.ready`; share via
`platform/share` with download + clipboard fallback; pre-written `wa.me` messages.

### 5.5 Web Push
**Read:** [frontend.md](frontend.md) · Push; [comms.md](comms.md).
**Do:** register `webpush` through `platform/push`; ask permission at the right moment (after
publishing); the iOS add-to-home-screen prompt; SW notification action buttons for check-ins.
**Done when:** a check-in push arrives and is answered from the notification on the reference
device, and on an iPhone with the PWA installed.

### 5.6 Mis casos, Bandeja, Perfil ◇
**Read:** [08](../product/08-notifications.md) (in-app inbox gets a copy of everything);
[auth.md](auth.md) · Profile.

---

## Phase 6 — Found

6.1 **Publish, match first** — 05 · Publishing: match first, then create; `withheld_detail` prompt.
6.2 **«Es mío»** — 05 · `ownership_claim`, The evidence ladder.
6.3 **Custodian view** — 05 · Two clocks; the day-15 adoption offer with its four exits.
6.4 **The three doors** — lost / found / sighting boundary from 05, as the entry UI.

Same step shape as phase 5: read the section, build, compare with the design, test every status.

---

## Phase 7 — Web launch

7.1 **Legal pages** — terms and privacy policy from [03](../product/03-legal-colombia.md), linked
from sign-in and publishing. *Drafts in place* at `/terminos` and `/privacidad`, in every language,
marked «Borrador» until the one lawyer review (03); the rights channel is `VITE_LEGAL_EMAIL`.
7.1b **Translations** — `en.json` read end to end by a fluent speaker; the legal pages exist in
every language the app offers, or the language links hide until they do.
7.2 **Production** — production API and env vars, Sentry alerts, MSW off in production builds,
`robots.txt` and the static pages' meta.
7.3 **Beta** — 10–20 real people for at least a week (the founders' networks); Sentry clean.
7.4 **Go live** — Lost & Found public on the web (product principle 1). Watch Sentry and the first
real cases for a week before phase 8.

## Phase 8 — Adoption, then Help

Same shape: domain machine (06 / 07 · Case state machine) → case page variant → publish flow →
owner/lister view → share. Adoption: [06](../product/06-adoption-workflow.md) («Me interesa»
4-field intro, what the lister sees). Help: [07](../product/07-help-workflow.md) (needs in kind,
«Yo ayudo» pledges the beneficiary confirms, trust tiers — never money).

---

## Scope 2 — Mobile (medium term)

Play Store + App Store together, from the same build wrapped in Capacitor ([frontend.md](frontend.md)
· Scopes). It can run in parallel with phase 8.

### M.0 Gates to start
- The web launch is stable: a few weeks live without serious Sentry issues.
- [O15](../open-items.md) (account deletion) decided — both stores require it.
- Hours available: the mobile scope is roughly a month of the team's budget; don't start it in
  the middle of a web phase.

### M.1 Accounts and identifiers
**Apple Developer Program** (USD 99/yr — enrollment can take days, start first) and **Google Play
Console** (USD 25 once); add both and live updates to [costs.md](costs.md). Decide the bundle /
application ID ([O13](../open-items.md), proposal `co.scuby.app` — permanent). Android Studio + JDK
locally; iOS builds run on a GitHub Actions macOS runner, so a Mac is optional.

### M.2 Map-in-webview spike ★
**Read:** [frontend.md](frontend.md) · Risks §1.
**Do:** a throwaway Capacitor build with the real `ui/Map` and ~300 pins, run on the reference
device against the phase 3.4 baseline. **If it fails, stop and decide** before any other M step.

### M.3 Capacitor projects ★
**Do:** Capacitor current major; `android/` + `ios/`; `capacitor.config.ts` (appId from M.1,
`webDir: 'dist'`); system bars, splash and icons from the design's assets.
**Done when:** the app runs on the reference device and on an iOS simulator or TestFlight.

### M.4 Store builds in CI ★
**Do:** Android: signed AAB on `main`, uploaded to the internal testing track, **Play App Signing
enrolled**. iOS: macOS runner builds and uploads to TestFlight with an App Store Connect API key.
Signing secrets only in GitHub secrets.
**Done when:** a merge to `main` produces an installable internal build on both stores.

### M.5 Native branches
**Do:** native branches in `src/platform/{location,camera,share,push,storage}`; push registers
`fcm` / `apns` (backend adds the senders); `@sentry/capacitor`.
**Done when:** `/dev/platform` works in both apps and a check-in push reaches each.

### M.6 Native sign-in + Apple ★
**Do:** `src/platform/auth` with the native Google plugin (Google blocks OAuth in webviews) and
**Sign in with Apple** — required by guideline 4.8 because we offer Google. Apple is offered on the
web too, so an Apple account made on an iPhone can sign in anywhere. Update [auth.md](auth.md) and
the D15 row in the same PR.
**Done when:** each door works on web, Android and iOS.

### M.7 Links that open the app
**Do:** serve `/.well-known/assetlinks.json` and `/.well-known/apple-app-site-association`; handle
`appUrlOpen` in `platform` and route it ([O13](../open-items.md)).
**Done when:** a `/c/:code` link shared months earlier opens the installed app on that case, and the
browser when the app isn't installed.

### M.8 Account deletion
**Do:** whatever [O15](../open-items.md) decided: «Eliminar mi cuenta» in profile plus a web URL
(Play requires it).

### M.9 Polish day
Safe areas, system bars, keyboard, Android back button, overscroll, long-press — on both apps
([frontend.md](frontend.md) · Risks §5).

### M.10 Live updates
Capgo or Capawesome channel; a test update reaches an installed build without a store release.

### M.11 Listings and privacy forms
Spanish listing copy, screenshots from the real app, icon; Play Data safety form and App Store
privacy labels written from [03](../product/03-legal-colombia.md)'s privacy policy.

### M.12 Beta, review, release
Internal testing + TestFlight with real users for at least a week; submit both; release. Once
live, the iOS-web install prompt offers the app first (frontend.md · Push).
