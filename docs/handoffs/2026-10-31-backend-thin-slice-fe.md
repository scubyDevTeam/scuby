# Handoff to the web client: the backend thin slice (2026-10-31)

> **The source of truth is the code (`backend/`) and the contract [`docs/eng/openapi.json`](../eng/openapi.json).**
> This file only orients: it says what exists, what changed in the product, and where each rule lives.
> When this file and the code or a linked doc disagree, the code and the doc win.
>
> **Delete this file once the web client has integrated with the backend.**

The backend's first release covers the lost-case slice: sign-in, the phone step, uploads, publishing a
lost case, the public case page, «Lo vi», the feed and «Mis casos». Everything else in the contract is
still answered only by the emulated backend in `web/src/mocks/`.

## 1. What is real today

Fifteen contract endpoints are implemented (the controllers under `backend/src/main/java/co/scuby`;
`ContractCoverageTest` fails the build if a controller route is missing from `openapi.json`):

| Method | Path | Area |
|---|---|---|
| `GET` | `/config` | Supported countries, `default_center` |
| `GET` | `/session` | Who is signed in |
| `POST` | `/auth/email/start` | Email code: send |
| `POST` | `/auth/email/verify` | Email code: verify, opens the session |
| `POST` | `/auth/google` | Google ID token → session |
| `POST` | `/auth/sign-out` | Ends the session |
| `GET` | `/me/profile` | The caller's profile (read only) |
| `POST` | `/me/phone` | Phone change: send the SMS code |
| `POST` | `/me/phone/verify` | Phone change: verify |
| `POST` | `/uploads` | Photo upload slot |
| `POST` | `/lost-cases` | Publish a lost case (phone step included) |
| `GET` | `/cases/{code}` | The case page (owner or public view) |
| `POST` | `/cases/{code}/sightings` | «Lo vi» (with the `client_id` replay) |
| `GET` | `/feed` | The feed (lost cases only) |
| `GET` | `/me/cases` | «Mis casos» |

Not implemented, among others: `PATCH /me/profile` (nobody can choose a name yet), `/me/pets`, case edit and
reopen, claims («Lo tengo», «Es mío»), sighting correction, deletion and the owner's sighting actions, shares,
found, adoption and help. The local and test profiles also serve `PUT/GET /dev-media/{sha256}.jpg`, a stand-in
for S3 and the image CDN that is not in the contract.

**The mock switch is all or nothing.** `VITE_API_MOCK` is one boolean (`web/src/env.ts`, `web/vite.config.ts`):
when it is `true`, `web/src/main.tsx` starts MSW with every handler in `web/src/mocks/handlers.ts`, and those
handlers answer the whole contract; when it is anything else, `@mocks/browser` resolves to an empty module
(`web/src/mocks/off.ts`) and every request goes to `VITE_API_URL`. Nothing in `web/src` lets one endpoint go to
the backend while another stays mocked. So integrating means one of two things: add a per-endpoint switch that
sends these fifteen to the backend and keeps the rest in MSW (for example MSW passthrough handlers for exactly
these routes), or wait until the backend covers what a screen needs.

## 2. Product changes you should know about

Each row gives the behaviour, the decision that owns it (in
[product/00 · Decision log](../product/00-product-map.md)) and what the client must do.

| Change | Decision · owning doc | What the client must do |
|---|---|---|
| **Google with an address Google does not vouch for, when an account with that email already exists, needs the email code first.** Only `gmail.com`, `googlemail.com`, or a Workspace token whose `hd` equals the email's domain, creates or links an account. With no account for that address, Google creates it directly (#70). With an existing account, any other address answers `401` with no session, and `401` with a session of a different email. With an email-code session of exactly that address, Google is linked for good, and after that Google alone signs in. | #58, #70 · [auth.md](../eng/auth.md) · Sign-in | **UI and copy:** a "confirm your email" screen («Entra primero con tu código de correo»), needed only when an account with that email already exists, then retry Google from the signed-in session. **Contract:** today the answer is the generic `unauthorized` with no distinct code, so the client cannot tell this narrower case from a rejected token; see the proposal in section 3. |
| **«Lo vi» has no rate limits**, neither per reporter per case, per reporter overall, nor per IP. They are deferred until real patterns are seen. | #54 · [04](../product/04-lost-workflow.md) · Validation | **Contract and mock:** the sighting endpoint's text ("rate-limited per reporter … before any limit"), the device cookie's text ("keys rate limits"), the mock's limits in `web/src/mocks/api/helpers.ts` (1 per 15 minutes, 5 per case, 20 a day) and the «demasiado pronto» copy (`too_soon`) all still promise them. Remove them ([O27](../open-items.md) item 3). Keep a generic `rate_limited` handler: any endpoint may still answer `429`. |
| **Uploads have no caps**, per caller or per IP. | #55 · [backend.md](../eng/backend.md) · Uploads and media | Nothing. The per-purpose photo counts of [media-pipeline.md](../eng/media-pipeline.md) §1 still apply. |
| **An unverified phone is never public.** The public case gets a WhatsApp link only if the number is exposed, marked as having WhatsApp, **verified**, not `in_app_only`, and the case is active. With the `publisher_phone_otp` kill switch off, a publish skips the SMS, stores the number unverified, and answers `{code}` at once. The case then has no public phone: only «Lo vi» and in-app contact. | #47 · [04](../product/04-lost-workflow.md) · Contact visibility · [auth.md](../eng/auth.md) · Behind a flag | **UI:** render the case's contact from the response only (`contact.whatsapp_url` may be `null` on an active case). Do not promise «te escribirán por WhatsApp» after a publish that skipped the code entry. **Contract:** `phone_step: unverified` does not exist yet, so the client cannot tell the number went unverified ([O24](../open-items.md)). |
| **The public name is never derived from the email.** If a person has not chosen a name, the case shows «Alguien» ("Someone" in English). A name supplied by Google counts as chosen. Chosen names are shortened («Carolina M.»). The person's own profile still shows a placeholder built from the address. | #48 · [04](../product/04-lost-workflow.md) · Contact visibility · [auth.md](../eng/auth.md) · Profile | **Nothing in the contract.** But `PATCH /me/profile` is not implemented, so on the real backend **every email-code publisher shows «Alguien»**. Expect it in screens and specs. Asking for a name belongs with the profile-update work. |
| **The feed is nearest first, with a national fallback.** Cases fall into bands of ≤ 2, 5, 10 and 25 km around the point, newest first within a band. With nothing near, or **no point sent**, the national feed comes back, newest first. At most 100 items. A lost case's public radius is floored at 200 m for everyone but its owner. | #41 · [api.md](../eng/api.md) · Proposals | **Client change:** `FeedPage.tsx` sends no `lat`/`lng`, so the real feed is national for everyone. Without a point the mock substitutes Medellín (`DEFAULT_CENTER` in `web/src/mocks/serialize.ts`), so the two disagree. Send the device position when granted, else `/config`'s `default_center`. The query parameters are also missing from `openapi.json` (section 3). |
| **SMS codes:** mobile numbers of a supported country only, otherwise `validation_failed`. A second send to a number within 60 s answers as sent but sends nothing. At most 5 sends per number in a rolling 24 h, counted across accounts; the sixth is `rate_limited` (429). **Email codes:** 60 s cooldown and at most 10 sends per address in a rolling 24 h. An email start always answers `204`, whether or not it sent. | #56, #57 · [auth.md](../eng/auth.md) · OTP mechanics, Sign-in | **UI and copy:** a resend control that waits 60 s, because a resend inside that window does nothing. Copy for `429` on `/me/phone` and on a publish that sends a code; it is new, to be written in `web/src/i18n/locales/` (for example «Pediste demasiados códigos para este número; intenta mañana»). The mock has no code-send limits, so these paths are only visible against the backend. |
| **A non-owner gets a snapped «last seen» center, and at most 200 sightings.** The public case view and every feed item carry the center rounded to a fixed ~200 m grid (the same value on every request; the owner sees the exact point), with the radius floored at 200 m as before. A case lists its 200 most recent visible sightings, oldest first, for owner and public alike; the feed's `sightings_count` is still the true count. | #63, #64 · [04](../product/04-lost-workflow.md) · Location precision, Display rules | **Map:** nothing breaks, because the client already draws a circle from `center` and `radius_m`. The snapped center is at most ~142 m from the exact point and the public radius is at least 200 m, so the circle still contains the point; draw it as given and do not try to correct or re-center it. Do not compare a public `center` with a value the client holds (for example the point just published): they differ by design. **Timeline and trajectory:** expect up to 200 pins, so do not assume a case's pin count equals the feed's `sightings_count`. **Mock:** it returns exact centers and every sighting; align it if a spec asserts either. |
| **A required field that is absent is `validation_failed`**, naming it by wire path (for example `pet.marks`). An explicit `null` is accepted where the contract allows it. | #51 · [api.md](../eng/api.md) · Errors | **Contract discipline:** send every required field, as `null` when empty. A body the mock accepted can be refused here. |
| **A double tap on «Publicar» creates two pets and two active cases.** The publish has no replay key yet. | [api.md](../eng/api.md) · Proposals (publish idempotency) | **UI now:** disable the button while the request is in flight. **Contract later:** a `client_id` on `publishLost` (section 3). |
| **Place names are a generic label**: «Zona marcada en el mapa» / "Area marked on the map". The `reverse_geocoding` flag is off and no provider is wired. | [feature-flags.md](../eng/feature-flags.md) · Registry · [backend.md](../eng/backend.md) · Place names | Nothing. Do not assert neighbourhood names (the mock's «Laureles») against the real backend, except on seeded rows. |

## 3. Contract proposals

They live in the docs; this list only points at them. Each is a change the client side makes, because the
client holds the pen until the contract moves to `openapi.yaml` (decision #34).

- `GET /feed` query parameters (`vertical`, `species`, `lat`, `lng`) missing from `openapi.json`, and the
  feed point: [api.md](../eng/api.md) · Proposals.
- Feed paging, and paging for `GET /me/cases`: [api.md](../eng/api.md) · Proposals.
- `phone_step: unverified` on publish responses: [O24](../open-items.md).
- `client_id` on `publishLost` (publish idempotency): [api.md](../eng/api.md) · Proposals.
- Rename the device cookie to `__Host-device`, and list the `Origin` check's `403`: [O27](../open-items.md)
  items 1 and 2.
- A distinct error code for "sign in with your email code first" on `/auth/google` (only when an account with that email exists):
  [api.md](../eng/api.md) · Proposals (Google with a non-Google address).
- Remove the «Lo vi» limits from the contract text and the mock: [O27](../open-items.md) item 3.
- The `seen_at` tolerance (the server allows 5 minutes in the future) and the `point` comment in `feed.ts`:
  [api.md](../eng/api.md) · Proposals.
- A copy review of the English look title («Dog black, small» → «Black dog, small»), which is backend text and
  not a contract change: [api.md](../eng/api.md) · Proposals.

## 4. Run the backend locally

Only Docker is needed (Maven runs in a container). The commands and their details are in
[backend/README.md](../../backend/README.md) · Cómo correrlo. In short:

```bash
bash backend/run-local.sh          # builds, starts Postgres + the API (profile local), waits for health
bash backend/run-local.sh down     # stops this checkout's project
```

- **Ports:** API on `http://localhost:8080` (`SCUBY_API_PORT` moves it), Postgres on `5433` (`SCUBY_DB_PORT`).
  The script refuses a port that something else holds.
- **CORS:** only `http://localhost:5173` (`pnpm dev`) and `http://localhost:4173` (the e2e preview build),
  with credentials (`backend/src/main/resources/application-local.yml`).
- **Point the client at it:** `VITE_API_MOCK=false VITE_API_URL=http://localhost:8080 pnpm dev` in `web/`.
  Cookies are `Secure` (the session is `__Host-session`). Chrome and Firefox accept them on `http://localhost`;
  older Safari may not (`backend/src/main/java/co/scuby/identity/CookieProperties.java`).
- **Test identities:** any `*@e2e.scuby.test` address and any `+57 300 000 00xx` number accept the fixed code
  `123456`. They skip cooldowns and caps, and no SMS is "sent" to them. For any other address or number, the
  code is written to the backend log with the recipient masked (decision #46): an email as its first
  character, `***@` and the domain, a phone as `***` and its last 4 digits. Read it with
  `COMPOSE_PROJECT_NAME=$(bash backend/compose-project.sh) docker compose -f backend/compose.yaml logs -f backend`.
- **Google does not work locally:** the backend's local client id is a placeholder, and the web build hides
  the button with the `mock-` id in `web/.env`.
- **Photos:** in the `local` profile, uploads go to `/dev-media` on the API itself. The upload slot's `PUT`
  URL and the photo URL both point at `http://localhost:8080/dev-media/{sha256}.jpg`, and a photo counts as
  processed as soon as its bytes arrive ([backend.md](../eng/backend.md) · Uploads and media).
- **Seed data:** `run-local.sh` starts with an empty database; only the e2e script loads
  [`backend/e2e/seed.sql`](../../backend/e2e/seed.sql), which holds two lost cases (`7K3PQ` active, `H4PPY`
  reunited) and three people at `@correo.co`. It can be loaded by hand into the local project. It **wipes the
  people, sessions, pets, cases, sightings and uploads first**:

  ```bash
  cd backend && COMPOSE_PROJECT_NAME=$(bash compose-project.sh) \
    docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U scuby -d scuby < e2e/seed.sql
  ```

  The seeded people's addresses are not test addresses locally. Their codes appear in the log as above.

## 5. E2E against the real backend

```bash
bash backend/e2e/run-client-e2e.sh                                # build, start, seed, run the specs
SCUBY_E2E_GREP="@feed|@FEED-001" bash backend/e2e/run-client-e2e.sh   # narrow the run
bash backend/e2e/run-client-e2e.sh --down                         # remove this project and its volume
```

The script runs a compose project of its own (`scuby-e2e-<checkout>`, API on `8080`, Postgres on `55433`,
preview on `4173`), loads `seed.sql`, and runs `web/e2e` through
[`backend/e2e/playwright.real.config.ts`](../../backend/e2e/playwright.real.config.ts) with
`VITE_API_MOCK=false`. By default it selects `@auth|@publish-lost|@case-link|@feed|@map|@offline`. Its
override [`compose.e2e.yaml`](../../backend/e2e/compose.e2e.yaml) adds `correo.co` and `+573007152284` to the
test bypass, because the specs sign in with those.

Last run (branch `be/thin-slice`, 2026-10-31): **16 tests, 8 pass, 8 fail; every failure is outside the
slice.**

| Tag | Title | Result | Why |
|---|---|---|---|
| @AUTH-001 | email-code sign-in | pass | |
| @AUTH-002 | sign in with Google | fail | No «Continuar con Google» button (no real Google client id in the build) |
| @PLOST-001 | publish a lost pet | pass | |
| @PLOST-002 | reactivate an expired notice | fail | Google sign-in; also needs `/me/pets` and reopen |
| @PLOST-003 | second sign-in | pass | |
| @PLOST-004 | two tabs, one backend | fail | Google sign-in; also needs `/me/pets` and case edit |
| @LINK-001 | shared link: who, where, what | fail | Only the «Posible hallazgo» assertion fails (needs claims); the steps after it never run |
| @LINK-002 | reunited case | pass | |
| @LINK-003 | purged case `GONE5` | pass | |
| @LINK-004 | share link | pass | |
| @FEED-001 | browse, filter, open a case | fail | Expects the mock's 9-case feed (lost, found, adoption, help); the backend has lost cases only and returns 1 |
| @FEED-002 | desktop list and map | fail | Same: 9 expected, 1 returned |
| @FEED-003 | phone map replaces the list | fail | Same, at the first step |
| @MAP-001 | grouped pins | fail | Same: `total` 9 expected, 1 returned |
| @MAP-002 | sighting sheet by keyboard | pass | |
| @OFFLINE-001 | «Lo vi» with no signal | pass | The queued sighting is replayed once through its `client_id` |

## 6. Suggested next steps for the client

- **Use the backend's default test identities in the specs:** `*@e2e.scuby.test` and `+57 300 000 00xx`.
  Then `compose.e2e.yaml`'s extra bypass for `correo.co` and `+573007152284` can go
  ([api.md](../eng/api.md) · Proposals, E2E test identities).
- **@LINK-001:** move the «Posible hallazgo» assertion to the end of the spec or make it `expect.soft`, so the
  trajectory and map steps run against a backend without claims.
- **A cross-actor journey spec:** the owner publishes, a stranger sees the case in the feed and sends «Lo vi»,
  and the owner sees the pin. Use two browser contexts, depend on no seed rows, and run it nightly against the
  real backend.
- **A Google test bypass for e2e**, so @AUTH-002, @PLOST-002 and @PLOST-004 can run against the backend
  ([api.md](../eng/api.md) · Proposals, E2E Google sign-in).
- **The FEED and MAP specs** assume the mock's mixed 9-case feed. They will pass against the backend only once
  found, adoption and help exist, or once they assert lost-only content.
