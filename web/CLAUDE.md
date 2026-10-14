# web/ — the client

Behaviour lives in `../docs/` and wins over this code and over the design. Architecture and the
reasons behind it: `../docs/eng/frontend.md`. Order of work: `../docs/eng/frontend-plan.md`.

## Commands (Node 24, pnpm)

| | |
|---|---|
| `pnpm dev` | Dev server. With `VITE_API_MOCK=true` (the default in `.env`) MSW answers the API |
| `pnpm check` | Everything CI runs: lint, types, unit tests, layer rule, brand check, build, size budget, e2e |
| `pnpm test` · `pnpm e2e` | Vitest unit tests · Playwright happy paths (uses the installed Chrome locally) |
| `pnpm format` | Biome, fixing what it can |
| `pnpm test:watch` | Vitest in watch mode |

## The layer rule (clean architecture: dependencies point inward)

Enforced by `.dependency-cruiser.cjs`; `pnpm depcruise` fails the build on a violation.

| Layer | Role | May import |
|---|---|---|
| `src/domain` | Entities and rules: state machines, validation, display rules. Plain TypeScript | nothing |
| `src/contracts` | The API boundary: wire schemas and the types the app uses | zod |
| `src/api-client` | Gateway to the backend: fetch, typed errors, queries | `contracts` |
| `src/platform` | Gateways to the device: share, location, camera, push, storage | browser APIs |
| `src/ui` | Presentation primitives. Know no rule, no API, no brand — props only | react |
| `src/features` | Use cases and their screens, one folder per vertical | all of the above |
| `src/routes` | Composition: URL → feature, wiring the router and config into props | everything |
| `src/mocks` | MSW handlers and fixtures. Only `main.tsx` starts them | `contracts` |

- A rule the docs define goes in `domain` with a test named after the doc section. `domain`
  advises the UI (what to offer); the server decides. Never enforce in the client.
- `features` never touch `fetch`, `navigator` or the router: they get data from `api-client`,
  capabilities from `platform`, and links as props from `routes`.
- Wire shapes in `contracts` are hand-written and provisional until the API spec exists (O14).

## Conventions

- UI copy is Spanish; identifiers are English. Route paths are Spanish (they are UI).
- The product name is configuration: read `src/brand.ts`, never spell it (`pnpm check:brand`).
- Env vars are read only in `src/env.ts`. Every key, with a mock value, is in `.env`; a value
  starting with `mock-` means "not configured" and the feature stays off.
- No feature flags in the client: when a flag changes a screen, the API response says so.
- Every screen renders its loading, empty and error states.
- **No feature without tests** (`../docs/eng/frontend.md` · Testing): unit tests next to the code
  for its rules and screen states, plus one happy-path spec in `e2e/`.
- The design: `design/reference/` (committed) and `design/screens/` (local, see its README).
