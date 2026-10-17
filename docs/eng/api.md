# API — The Contract Between Client and Backend

> Decided 2026-10-14 (decision #24). The contract is written first, in the client's code, and the
> backend implements it. The client and an emulated backend already run on it, so the real backend
> is a plug: point the app at it and nothing else changes.

## Where the contract lives

| What | Where | Edited by hand? |
|---|---|---|
| **Every endpoint**: method, path, auth, request, response, status, errors | [`web/src/contracts/api.ts`](../../web/src/contracts/api.ts) | **Yes — the source** |
| Wire shapes (Zod) | `web/src/contracts/*.ts`, referenced from `api.ts` | Yes |
| Error codes and their HTTP status | [`web/src/contracts/errors.ts`](../../web/src/contracts/errors.ts) | Yes |
| **OpenAPI 3.1 document** | [`openapi.json`](openapi.json) | **No** — `pnpm openapi` in `web/` generates it; CI fails when it is stale |
| Behaviour the backend must reproduce | [`web/src/mocks/backend.test.ts`](../../web/src/mocks/backend.test.ts) — scenarios run against the emulated backend | Yes |

Changing the API = edit `api.ts` (and its schemas), run `pnpm openapi`, commit both. The client
calls only through `api.ts` (`call(api.getCase, …)`) and the emulated backend answers only through
it, so neither can use an endpoint the contract does not list.

## Conventions

- **JSON, snake_case**, UTF-8. Times are ISO 8601 with an offset. Phones are E.164. Points are
  `{ lat, lng }`. Every enum is an English key — including a pet's `colors` (`black`, `tan`…) —
  and the client names it in the screen's language.
- **Language: `Accept-Language`.** Every request carries the screen's language (`es`, `en`). The
  values the server composes for display (`place_name`, `title` and `summary` of a found case,
  match `why`, notification `body`) come in that language; nothing else on the wire is language
  ([frontend.md](frontend.md) · Languages). Push and email: [O17](../open-items.md).
- **Session: an httpOnly cookie** on a same-site API origin (O12 leaning); every request is sent
  with credentials. No endpoint returns a token. `auth: session` endpoints answer `unauthorized`
  without one; who may act on *what* is each endpoint's `forbidden`.
- **The same URL answers more to the person responsible.** `GET /cases/:code` carries `viewer`;
  claims, reporters' numbers, hidden pins, the pending check-in and the withheld detail are sent
  only to the case's publisher. Filtering is the server's job — never the client's.
- **Responses are complete.** The document's response schemas are the output side: every field
  present, `null` rather than absent. Request schemas are the input side: fields with a default
  may be left out.
- **Feature flags never reach the wire** ([feature-flags.md](feature-flags.md)): a response says
  the outcome — `phone_step: otp` — never the flag.
- **Replays are idempotent where the client queues.** «Lo vi» (`POST /cases/:code/sightings`) carries
  a `client_id` the client makes once and sends again on every retry: the same key on the same case
  answers the sighting it already created — before any rate limit — so a send whose answer was lost
  on the way never becomes two pins ([frontend.md](frontend.md) · Risks §6).
- **The email's one-tap links are public** (`/checkin-links/:token`): the token is the auth — single
  use, expiring, bound to one check-in and one answer. A GET applies only a safe answer; a
  consequential one waits for the POST of its confirm page ([comms.md](comms.md) · The scanner rule).
- **Server decides.** Every rule the client checks for feedback (sighting distance and time, phone
  format) the server checks again; rate limits, schedules, expiry and matching are server-only
  ([frontend.md](frontend.md) · Rule 2).

## Errors

Every failure has the same body, and the client writes its own copy per `code` — `message` is for
logs:

```json
{ "error": { "code": "active_case_exists", "message": "…", "details": { "case_code": "7K3PQ" } } }
```

| Code | Status | When |
|---|---|---|
| `validation_failed` | 422 | Body or query breaks the schema; `fields` maps each wire path to what is wrong |
| `unauthorized` | 401 | No session on a `session` endpoint |
| `forbidden` | 403 | Signed in, but it is someone else's case, claim or notification |
| `not_found` · `gone` | 404 · 410 | Unknown · purged (a printed poster's code still resolves) |
| `invalid_transition` | 409 | The action does not fit the case's status |
| `active_case_exists` | 409 | The pet already has an active lost case; `details.case_code` |
| `invalid_code` · `phone_required` | 422 | The emailed/SMS code is wrong · publishing with no verified number |
| `sighting_too_far` · `seen_at_in_future` · `seen_at_before_case` | 422 | [04 · Validation](../product/04-lost-workflow.md) |
| `rate_limited` | 429 | Per reporter, per case and global ([04](../product/04-lost-workflow.md)) |
| `server_error` | 500 | — |

Any endpoint may answer `validation_failed`, `rate_limited` and `server_error`; every other code
must be in that endpoint's `errors`. The emulated backend enforces this, so the list stays true.

## Plugging in the real backend

1. Implement [`openapi.json`](openapi.json). The scenarios in `backend.test.ts` are the behaviour
   behind it (who sees what, the phone step, the follow-up loop, expiry, matching's shape).
2. Run the app against it: `VITE_API_MOCK=false VITE_API_URL=https://… pnpm dev` (or the same in
   the Vercel env). No code changes.
3. Run the e2e suite against it the same way. A green suite on the real backend is the acceptance
   test of the plug.
4. Replace the transition-table contract tests' target with the real API before the second
   vertical ([frontend.md](frontend.md) · Risks §2).

## What the emulated backend does — and does not

It is a small backend in the browser (`web/src/mocks/`): tables (`tables.ts`), seeded from
`fixtures.ts` and kept per tab; per-viewer serialization (`serialize.ts`); the follow-up loop run
before each request (`followup.ts`: check-ins, stale claims, expiry); the inbox (`notify.ts`); and
every handler wrapped by `route.ts`, which validates each request and each answer against
`api.ts`. Sign-in accepts the code `123456`; «Continuar con Google» signs into the demo owner.

Simplified on purpose — the real backend must do better:

| Emulated as | Real |
|---|---|
| Uploads stored inline as data URLs | Signed upload URLs and the media pipeline — **the one provisional endpoint** (O10) |
| Neighbourhood = nearest of a fixed list | Reverse geocoding |
| Rate-limit handle = a random id in localStorage | Device/IP key |
| Matching = same species within 5 km | The matching contract in [05](../product/05-found-workflow.md) (O7) |
| Follow-up loop runs on each request | A scheduled job; push and email deliveries ([comms.md](comms.md)) |
| Inbox only | Push, email, quiet hours, coalescing ([08](../product/08-notifications.md)) |
| Chat threads in a table, polled every 15 s while a thread is open; closed = its case is no longer active | Twilio Conversations behind the same endpoints: lazy creation at the first message, `state=closed` on resolution, purge by `DELETE` ([comms.md](comms.md)) |
| Display text composed in Spanish, whatever `Accept-Language` says | Composed in the request's language |

Not in the contract yet: the chat's automatic first message (the claim's evidence, the interest's introduction — the emulation only seeds them), the unread messages in the bottom bar's badge, found-case check-ins (the custodian's «¿sigues con él?»), purge after 30
days, and `«Lo tengo»` on an expired case (O3).
From help ([07](../product/07-help-workflow.md)): photos on a request beyond the pet's own, a
request for a custodian's found animal opened from its found case, and operator review into
`verified` (O9). From the profile ([auth.md](auth.md) · Profile): the photo, changing the phone outside a
publish (start + verify an OTP), whether the phone is verified, and account-level contact prefs.
From check-ins (04 · `case_checkin`): the date the case archives if nobody answers, which the copy
«archivaremos la publicación en 5 días» needs. From push ([frontend.md](frontend.md) · Push): the **push
payload** the service worker reads — today `{ title, body, url, tag?, checkin?: { code, id,
actions[] } }` in `web/src/service-worker/push.ts`, to be agreed and moved here — and what
`device` on a push subscription holds (the client sends `null`). From sharing (10 §5): an endpoint
for `share.opened`; the client records nothing yet. Each arrives as entries in `api.ts` with the
feature that needs it.
