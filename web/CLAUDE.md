# web/ — the client

Behaviour lives in `../docs/` and wins over this code and over the design. Architecture and the
reasons behind it: `../docs/eng/frontend.md`. Order of work: `../docs/eng/frontend-plan.md`.

## Commands (Node 24, pnpm)

| | |
|---|---|
| `pnpm dev` | Dev server. With `VITE_API_MOCK=true` (the default in `.env`) MSW answers the API |
| `pnpm check` | Everything CI runs: lint, types, unit tests, layer rule, brand check, copy check, e2e tags, build, e2e, Lighthouse (`/c/:code` LCP) |
| `pnpm test` · `pnpm e2e` | Vitest unit tests · Playwright happy paths (uses the installed Chrome locally) |
| `pnpm e2e --grep @owner` | One flow, or one test by its key (`--grep @OWNER-001`) |
| `pnpm openapi` | Regenerates `../docs/eng/openapi.json` from `src/contracts/api.ts`. Run after any contract change |
| `pnpm format` | Biome, fixing what it can |
| `pnpm test:watch` | Vitest in watch mode |

## The layer rule (clean architecture: dependencies point inward)

Enforced by `.dependency-cruiser.cjs`; `pnpm depcruise` fails the build on a violation.

| Layer | Role | May import |
|---|---|---|
| `src/domain` | Entities and rules: state machines, validation, display rules. Plain TypeScript | nothing |
| `src/contracts` | **The API contract**: every endpoint in `api.ts`, wire schemas, error codes, the app's types | zod |
| `src/api-client` | Gateway to the backend: fetch, typed errors, queries | `contracts` |
| `src/platform` | Gateways to the device: share, location, camera, push, storage | browser APIs |
| `src/ui` | Presentation primitives. Know no rule, no API, no brand — props only | react, `i18n` |
| `src/i18n` | The language files (`locales/<lang>.json`), `t()`, the provider | react |
| `src/features` | Use cases and their screens, one folder per vertical | all of the above |
| `src/routes` | Composition: URL → feature, wiring the router and config into props | everything |
| `src/mocks` | The emulated backend: tables, fixtures, handlers. Only `main.tsx` starts it | `contracts` |

- A rule the docs define goes in `domain` with a test named after the doc section. `domain`
  advises the UI (what to offer); the server decides. Never enforce in the client.
- `features` never touch `fetch`, `navigator` or the router: they get data from `api-client`,
  capabilities from `platform`, and links as props from `routes`.
- **The contract is the API** (`../docs/eng/api.md`). A new endpoint or field starts in
  `src/contracts/api.ts` and its schemas; the client calls it with `call(api.x, …)`, never with a
  hand-built path; the emulated backend answers it with `route(api.x, …)`, which validates the
  request and the answer. Then `pnpm openapi`. Tests fail when a handler is missing, an answer
  breaks the schema, an error code is not listed, or `openapi.json` is stale.
- A behaviour the backend owns (who sees what, schedules, expiry, rate limits) gets a scenario in
  `src/mocks/backend.test.ts`: it is the spec the real backend reproduces.

## Conventions

- **No copy in the code** (`../docs/eng/frontend.md` · Languages): every word on screen is a key in
  `src/i18n/locales/es.json` with its translation in `en.json` (same keys, same `{placeholders}`
  and `<tags>`), read with `const { t, rich } = useI18n()`. Keys are English snake_case, nested by
  screen; enums stay keys (`pet.colors.black`). `pnpm check:copy` fails on copy written in a screen.
- The language is the URL's optional first segment (`/en/c/7K3PQ`; Spanish has none): every route
  lives under `src/routes/{-$locale}/` and links inherit the segment. Route paths are Spanish in
  every language.
- The product name is configuration: read `src/brand.ts`, never spell it (`pnpm check:brand`).
- Env vars are read only in `src/env.ts`. Every key, with a mock value, is in `.env`; a value
  starting with `mock-` means "not configured" and the feature stays off.
- No feature flags in the client: when a flag changes a screen, the API response says so.
- Every screen renders its loading, empty and error states.
- **No feature without tests** (`../docs/eng/frontend.md` · Testing): unit tests next to the code
  for its rules and screen states, plus one happy-path spec in `e2e/`.
- **e2e specs use page objects** (`e2e/pages/`): selectors live there, never in a spec. Every
  page-object action goes through `step()` (`e2e/pages/step.ts`, a boxed `test.step`); every spec
  groups its phases in `test.step('what this phase shows', …)` with the assertions inside. Every test
  is declared `test(title, tags('@flow', '@KEY-NNN'), …)` — a flow from `e2e/tags.ts` and a key of
  its own, never reused. A new flow is a new row in `e2e/tags.ts`.
- The design: `design/reference/` (committed) and `design/screens/` (local, see its README).
