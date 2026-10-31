# API — The Contract Between Client and Backend

> Decided 2026-10-14 (decision #24), amended 2026-10-24 (#34). The contract is written first and the
> backend implements it; who holds the pen is staged below. The client and an emulated backend already run on it, so the real backend
> is a plug: point the app at it and nothing else changes.

## Where the contract lives

| What | Where | Edited by hand? |
|---|---|---|
| **Every endpoint**: method, path, auth, request, response, status, errors | [`web/src/contracts/api.ts`](../../web/src/contracts/api.ts) | **Yes — the source** |
| Wire shapes (Zod) | `web/src/contracts/*.ts`, referenced from `api.ts` | Yes |
| Names of the wire shapes (`Sighting`, `PublishLostRequest`…) | [`web/src/contracts/names.ts`](../../web/src/contracts/names.ts) — derived from each schema's export name (`sightingWire` → `Sighting`); no hand-kept list | No |
| Error codes and their HTTP status | [`web/src/contracts/errors.ts`](../../web/src/contracts/errors.ts) | Yes |
| **OpenAPI 3.1 document** | [`openapi.json`](openapi.json) | **No** — `pnpm openapi` in `web/` generates it; CI fails when it is stale |
| Behaviour the backend must reproduce | [`web/src/mocks/backend.test.ts`](../../web/src/mocks/backend.test.ts) — scenarios run against the emulated backend | Yes |

**Staging (decision #34).** Stage 1 — now: the source stays `api.ts`, and every wire shape is named
(`names.ts`), so `openapi.json` carries `components/schemas` and `$ref`s instead of inlined
objects. Stage 2 — after the Java spike ([backend-plan.md](backend-plan.md) · 0.4) shows the
generator yields usable records: `docs/eng/openapi.yaml` (not created yet) becomes the hand-edited source,
either side proposes changes in a PR the other reviews, the backend generates its types and the
client its Zod from it, and the table above flips (`api.ts` and `contracts/*.ts` become generated;
`openapi.json` goes away).

Changing the API (stage 1) = edit `api.ts` (and its schemas), run `pnpm openapi`, commit both. The client
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
- **Session: an httpOnly cookie** on a same-site API origin (decision #37); every request is sent
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
  answers the sighting it already created — before every validation — so a send whose answer was lost
  on the way never becomes two pins ([frontend.md](frontend.md) · Risks §6).
- **The email's one-tap links are public** (`/checkin-links/:token`): the token is the auth — single
  use, expiring, bound to one check-in and one answer. A GET applies only a safe answer; a
  consequential one waits for the POST of its confirm page ([comms.md](comms.md) · The scanner rule).
- **Server decides.** Every rule the client checks for feedback (sighting distance and time, phone
  format) the server checks again; rate limits, schedules, expiry and matching are server-only
  ([frontend.md](frontend.md) · Rule 2).

## Device identity

Someone without an account is a **device**: an opaque `device` cookie that the API sets (decision #35).

- **Set by the API, never by the client.** Any answer to a request that arrives without a valid one
  carries `Set-Cookie: device=…` — random, ≥ 128 bits, `HttpOnly; Secure; SameSite=Lax; Path=/`, one
  year, renewed when used. The client reads nothing and sends nothing extra: it already sends every
  request with credentials (`api-client/http.ts`). The server keeps only a hash of the value.
- **What it identifies.** The anonymous reporter or claimant of a sighting or a «lo tengo»: it
  authorizes correcting or deleting their own sighting inside its window, and marks it `mine` on the
  case (there are no per-reporter rate limits for now — [04](../product/04-lost-workflow.md) · Validation). It also scopes an anonymous upload slot (*Uploads*).
- **Not an account, never a login.** A signed-in session wins when both are present; the cookie
  proves nothing about who someone is, only that this is the same browser. Clearing cookies forgets
  it — the person loses the right to correct what they sent, nothing else. Moving an anonymous
  sighting to an account on sign-in is not part of this contract.
- **Native apps** (Capacitor, another origin) cannot rely on it; they get the token transport of
  [D16](../open-items.md) at stage 2a, and the same server-side meaning.
- The OpenAPI document lists it as the `device` security scheme. No endpoint requires it.

## Uploads

A photo reaches storage in three steps (decision #36; the pipeline's rules are
[media-pipeline.md](media-pipeline.md) §1, the AWS side [infra.md](infra.md) · Media):

1. **Ask for a slot** — `POST /uploads` with `{ purpose, sha256, content_type: 'image/jpeg', bytes }`:
   the photo as the device prepared it (≤ 1600 px, EXIF gone) and its hash. `purpose` is what the
   photo is for — `pet`, `sighting`, `claim`, `evidence`, `profile` — and the slot is scoped to it
   and to who asks (the session, or the device).
2. **Send the bytes** — the answer's `upload` is `{ method: 'PUT', url, headers, expires_at }`: a
   presigned PUT, valid minutes, signed with the hash so storage refuses other bytes. The client
   sends the bytes there, with those headers, and nothing else (no cookie, no `Accept-Language`).
   `upload` is `null` when that exact photo is already stored: there is nothing to send.
3. **Use the URL** — the answer's `url` is where the photo will be (derived from the hash, so a
   re-upload is the same URL). It goes into the publish body (`photo_urls`) as is.

Rules the server enforces, and the client may not predict:

- **Limits per purpose** ([media-pipeline.md](media-pipeline.md) §1). Slots have no rate limit
  ([backend.md](backend.md) · Uploads and media). A refused slot is `validation_failed`.
- **A photo in a publish body must be one this caller uploaded for that purpose** (or one already on
  the row being edited); anything else is `validation_failed` on that field. So is a photo whose
  bytes have not been processed yet — it takes seconds, normally done before the form is.
- A slot never used leaves an object in `incoming/` that expires; nothing is attached to a row until
  a publish names it.

## Errors

Every failure has the same body, and the client writes its own copy per `code` — `message` is for
logs:

```json
{ "error": { "code": "active_case_exists", "message": "…", "details": { "case_code": "7K3PQ" } } }
```

| Code | Status | When |
|---|---|---|
| `validation_failed` | 422 | Body or query breaks the schema; `fields` maps each wire path to what is wrong. A required field that is absent is an error naming it (nested ones by path, e.g. `pet.marks`); an explicit `null` is accepted where the contract allows it (decision #51 in [00](../product/00-product-map.md)) |
| `unauthorized` | 401 | No session on a `session` endpoint |
| `forbidden` | 403 | Signed in, but it is someone else's case, claim or notification |
| `not_found` · `gone` | 404 · 410 | Unknown · purged (a printed poster's code still resolves) |
| `invalid_transition` | 409 | The action does not fit the case's status |
| `active_case_exists` | 409 | The pet already has an active lost case; `details.case_code` |
| `invalid_code` · `phone_required` | 422 | The emailed/SMS code is wrong · publishing with no verified number |
| `sighting_too_far` · `seen_at_in_future` · `seen_at_before_case` | 422 | [04 · Validation](../product/04-lost-workflow.md) |
| `rate_limited` | 429 | Too many SMS codes requested for one number ([auth.md](auth.md)); an email start never answers it (it answers `204` and sends nothing) |
| `server_error` | 500 | — |

Any endpoint may answer `validation_failed`, `rate_limited` and `server_error`; every other code
must be in that endpoint's `errors`. The emulated backend enforces this, so the list stays true. One known exception: the real backend also answers `forbidden` to an unsafe request from a disallowed origin, on every endpoint, before it is routed ([backend.md](backend.md) · Security); the contract does not list it yet ([O27](../open-items.md)).

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
`fixtures.ts` and kept in this browser's storage, shared by its tabs (the demo's «Restablecer» goes back to the fixtures); per-viewer serialization (`serialize.ts`); the follow-up loop run
before each request (`followup.ts`: check-ins, stale claims, expiry); the inbox (`notify.ts`); and
every handler wrapped by `route.ts`, which validates each request and each answer against
`api.ts`. Sign-in accepts the code `123456`; «Continuar con Google» signs into the demo owner.

Simplified on purpose — the real backend must do better:

| Emulated as | Real |
|---|---|
| Uploads: the same three steps against an emulated bucket (`api/media.ts`), bytes kept as data URLs; nobody checks who may attach which photo | Presigned S3 PUTs, the ingest Lambda and CloudFront variants ([infra.md](infra.md) · Media); ownership of a photo enforced at publish |
| Neighbourhood = nearest of a fixed list | Reverse geocoding |
| The `device` cookie = a random id in localStorage (the client never reads it) | The API-set cookie of *Device identity*; IP as a second key |
| Matching = same species within 5 km | The matching contract in [05](../product/05-found-workflow.md) (O7) |
| Follow-up loop runs on each request | A scheduled job; push and email deliveries ([comms.md](comms.md)) |
| Nearby alerts stored as a zone on the account; nothing sends them | The matching/broadcast job that notifies by zone ([08](../product/08-notifications.md)) |
| Inbox only | Push, email, quiet hours, coalescing ([08](../product/08-notifications.md)) |
| A claim or an interest opens its thread with an automatic first message (evidence / introduction); chat threads in a table, polled every 15 s while a thread is open; closed = its case is no longer active | Twilio Conversations behind the same endpoints: lazy creation at the first message, `state=closed` on resolution, purge by `DELETE` ([comms.md](comms.md)) |
| Display text composed in Spanish, whatever `Accept-Language` says | Composed in the request's language |

Not in the contract yet: purge after 30
days.
From help ([07](../product/07-help-workflow.md)): operator review into
`verified` (O9). From the profile ([auth.md](auth.md) · Profile): whether the phone is verified, and account-level contact prefs. From push ([frontend.md](frontend.md) · Push): the **push
payload** the service worker reads — today `{ title, body, url, tag?, checkin?: { code, id,
actions[] } }` in `web/src/service-worker/push.ts`, to be agreed and moved here — and what
`device` on a push subscription holds (the client sends `null`). Each arrives as entries in `api.ts` with the
feature that needs it.

### Gaps found by the backend review (2026-10-23)

A pass of every doc against the contract found these missing or in conflict. Each lands as a
contract change with the feature that needs it. The two that blocked the backend's first slice
([backend-plan.md](backend-plan.md) · S.0) are settled — *Device identity* (#35) and *Uploads*
(#36) above.

- **Moderation.** No operator queue or actions, and no «en revisión» state on a case an author
  sees ([09](../product/09-reporting.md)).
- **Lost-publish matching.** `POST /matches` returns lost pets only; [05](../product/05-found-workflow.md)
  · Where it runs also matches a new lost case against found cases and orphan sightings.
- **Chat transport and cost.** The contract proxies chat through REST with polling and opens a
  thread automatically on every «es mío» and «me interesa»; [comms.md](comms.md) has the client SDK
  connecting only when the chat opens and conversations created lazily on the first message, never
  on intent (cost rule 1).
- **Phone on «Me interesa».** [auth.md](auth.md) says interest askers are never asked for a phone;
  the contract requires a verified one.
- **Feed order** — settled by decision #41 in [00](../product/00-product-map.md), which owns the
  rule. The contract's wording is to follow (Proposals, below).
- **Smaller:** `contact.opened {whatsapp_click}` ([04](../product/04-lost-workflow.md) · Events) has
  no endpoint; a found-case claimant cannot withdraw «es mío»; match rejections leave no record
  ([05](../product/05-found-workflow.md) · Events); unmerge has no surface.


### Proposals from the first backend release (2026-10-29)

Contract or client changes the backend needs; each is made on the client side, which owns the pen
until the contract moves to `openapi.yaml` (decision #34). The backend's first release is the
lost-case slice: uploads, publish, the public case, «Lo vi», the feed and the caller's own cases. The device cookie rename to
`__Host-device` is already [O27](../open-items.md).

- **Feed paging** — the feed is capped at 100 items with no way to ask for more.
- **`phone_step: unverified`** on publish responses — proposed in [O24](../open-items.md).
- **`GET /feed` query parameters** (`vertical`, `species`, `lat`, `lng`) are missing from
  `openapi.json` (`parameters: []`) although `web/src/contracts/feed.ts` defines them.
- **`seen_at` tolerance** — the server accepts up to 5 minutes in the future (device clock drift);
  the client's own check rejects any future time.
- **Nearest-first wording** — the contract's summary says "newest first"; `feed.ts` and
  [02](../product/02-flows.md) say proximity; align them on the rule above.
- **Feed point** — the client never sends `lat`/`lng` (`FeedPage.tsx` builds the query from
  `vertical`/`species` only), so the feed is national for everyone. The client should send the
  device position when the user grants it, else the selected country's `default_center` from
  `/config`. The server rule is ready; its spatial index (a GiST index on the case's last-seen
  point) waits for the first request that uses it.
- **Publish idempotency** — a double tap on «Publicar» creates two pets and two active cases; add a
  `client_id` to `publishLost`, replayed like a sighting's.
- **Google with a non-Google address** — the backend answers `401` when the Google address is not
  one Google vouches for and the browser has no email-code session of that same address (or has one
  of another address) ([auth.md](auth.md) · Sign-in, the "One account per email" rule). Add a distinct error code the
  client can turn into «Entra primero con tu código de correo»; with a session of the same address,
  signing in with Google links it.
- **E2E test identities** — the client's e2e specs sign in with `ana.gomez@correo.co` and the phone
  `+573007152284`, which the backend's test bypass accepts only through an extra compose override.
  Use `*@e2e.scuby.test` and `+57 300 000 00xx` (the bypass defaults) and the override is not needed.
- **E2E Google sign-in** — the «Continuar con Google» button is hidden when the build has no real
  Google client id (`web/.env` has a `mock-` one), so the three Google specs (@AUTH-002, @PLOST-002,
  @PLOST-004) cannot run against the backend; they need a documented e2e environment or a backend
  bypass, planned with the phase that adds Google.
- **@LINK-001** ends its first step ("who is missing, and what a stranger can do") with the
  «Posible hallazgo» assertion, which needs an open claim, outside the first backend release. A
  failing `expect` inside a `test.step` still ends the test, so the steps after it (the sightings
  trajectory among them) never run. Move that assertion to the end of the spec, make it
  `expect.soft`, or split it into its own `test` (or tag).
- **`point` comment in `feed.ts`** — it says "public precision, never a doorstep", but the center is
  not moved ([04](../product/04-lost-workflow.md) · Location precision); only the radius is floored.
- **Paging for `GET /me/cases`** — it returns every case of the caller, with no way to page.
- **Endpoints the e2e specs need beyond the first backend release** — `/me/pets` (the lost-pet
  re-publish flow of @PLOST-002 and @PLOST-004), case edit (@PLOST-004), Google sign-in
  (@AUTH-002, @PLOST-002, @PLOST-004) and claims (the «Posible hallazgo» state of @LINK-001).
- **Not a proposal: the English look title.** `GET /me/cases` titles a case whose pet has no name
  from species, first colour and size; in English it reads «Dog black, small» (Spanish word order).
  It needs a human copy review («Black dog, small»). The backend owns the text, so this is a copy
  decision, not a contract change.
