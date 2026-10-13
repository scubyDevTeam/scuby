# Scuby

Pet lost/found/adoption/help platform. Colombia-first, never Colombia-only. Side project: two
engineers, ~10–15 h/week — every design decision respects that budget. Docs-first phase: the
product and engineering source of truth is `docs/`; there is no application code yet.

## Where truth lives

| Path | What |
|---|---|
| `docs/product/00-product-map.md` | Mission, principles, **decision log** (numbered, dated, with rejected alternatives) |
| `docs/product/01–03` | Actors + entities, flow summaries, legal (Colombia instance) |
| `docs/product/04–07` | The four verticals: lost, found, adoption, help. **Source of truth for their flow** — on conflict they win over 00–02, and the summary gets patched in the same change |
| `docs/product/08–10` | Cross-cutting behavior: notifications, reporting, sharing |
| `docs/eng/` | How we build: `frontend.md` (client architecture), `frontend-plan.md` (step-by-step build plan), `auth.md`, `comms.md` (channels/ladders/Conversations), `costs.md` (monthly spend + triggers), `feature-flags.md` (global/per-account flags + registry), `media-pipeline.md` (backend, infra pending) |
| `docs/open-items.md` | Open (undecided) and Deferred (decided not-now) — **the v1 contract**: Deferred rows are documentation, never requirements; build nothing from them |

## Rules for working in this repo

1. **One home per fact.** Before writing a decision anywhere, find its owning doc. Link from
   everywhere else — never restate. A fact that lives in two files is already wrong in one.
2. **Decisions land in the decision log** (`product/00`) with a date and the rejected
   alternatives; the mechanics land in the owning doc. Chat is not a home.
3. **Designing screens?** The UI contracts are in the docs, not implied: any publish flow =
   `eng/auth.md` (phone step) + that vertical's *Publishing* section; maps/pins = `product/04`
   display rules + location precision; cards/posters = `product/10`; notification copy =
   `product/08`.
4. **Events exist only with a consumer** (N notification / M non-derivable metric / A audit) —
   rule and tags in `product/08`. Everything else is a query over rows.
5. **Country-scoped values** (phone prefixes, currency, legal) go through configuration
   (`supported_countries` — `eng/auth.md`), never hard-coded.
6. Spanish strings are UI copy; domain identifiers are English snake_case.
7. Git: `gh auth switch --user scubydev-rgb` before GitHub operations (work account can't see
   this repo).
