# Backend Build Plan — Step by Step

> The runbook for building the backend and its infrastructure from zero. **What** we build and
> **why** live in [backend.md](backend.md), [infra.md](infra.md), [api.md](api.md) and the product
> docs; this doc only orders the work. Written 2026-10-23.
>
> **Goal:** the web launch of Lost & Found ([00 · #1, #20](../product/00-product-map.md)) on a real
> backend. **First milestone:** a thin slice — sign in, publish a lost case, view it, report a
> sighting — running on staging with the client pointed at it, so the client leaves the emulated
> backend as early as possible.

## How to use this doc

- **One step = one branch = one PR.** Branch name `be/<step>-<slug>` (e.g. `be/0.2-postgres-image`)
  or `infra/<step>-<slug>`. Steps are sized for one or two working sessions.
- **Every step has the same shape:** *Read* (the docs that own the behaviour), *Do*, *Done when*
  (checkable).
- **The contract is shared.** A step that needs an endpoint changed or added changes the contract
  first, in a PR the client engineer reviews ([api.md](api.md); the process is decision #34.
- **When a step forces a decision**, it lands in the owning doc and the decision log in the same
  PR (repo rule 2).
- **Global definition of done:** integration tests for the behaviour, responses validated against
  the contract, CI green, no doc contradicted.

## Map

| Phase | What | Client affected? |
|---|---|---|
| P | Prerequisites: accounts, domain, decisions to close | No |
| 0 | Foundation: project, database image, data access, contract harness, CI | No |
| I | Staging infrastructure on AWS | No |
| S | **Thin slice:** auth, phone step, publish lost, view case, «Lo vi» with photos | **Yes — first real plug** |
| L | Rest of Lost & Found: claims, follow-up loop, notifications, broadcast, found, chat, moderation | Yes |
| X | Production and launch | Yes |
| V | Adoption, then Help | Yes |

---

## Phase P — Prerequisites

**P.1 Accounts.** New AWS account (Free Plan credits; set AWS Budgets alarms), GitHub access to
`scubyDevTeam/scuby`, Twilio (OTP sender number), Resend, Google OAuth client, Sentry project for
the backend, New Relic account.

**P.2 Domain.** Register or point the domain into Route 53 (the name itself is
[O16](../open-items.md); the working name is fine for staging).

**P.3 Decisions to close before code.**
- Build tool (Gradle or Maven) and the folder layout: `backend/` and `infra/` beside `web/`.
- ~~Contract source~~ — closed by decision #34 (staged: named schemas now, `openapi.yaml` as source
  after the 0.4 spike).

## Phase 0 — Foundation

**0.1 Project.** *Read:* [backend.md](backend.md). *Do:* Spring Boot 4.1 / Java 25 project in
`backend/`, virtual threads on, Actuator, profiles `local`/`test`/`staging`/`prod`, the
`@ApiComponent` / `@WorkerComponent` annotations. *Done when:* the app starts locally and answers
`/actuator/health`.

**0.2 Postgres image.** *Read:* [infra.md](infra.md) · Database. *Do:* the project image
(`postgres:17` + PostGIS from PGDG), published for amd64 and arm64; a Compose file for
local development. *Done when:* the image runs on an Apple-silicon laptop and in CI, and
`CREATE EXTENSION postgis` succeeds.

**0.3 Schema pipeline.** *Do:* Flyway with the first migration; jOOQ code generation against a
Testcontainers database migrated by Flyway; the PostGIS template helpers and `geography` binding.
*Done when:* a spatial query (`ST_DWithin`) runs from jOOQ in an integration test.

**0.4 Contract harness.** *Read:* [api.md](api.md), [backend.md](backend.md) · The API contract.
*Do:* the error body and codes of [api.md](api.md) · Errors; a test helper that validates every
response against `openapi.json`. Spike: does openapi-generator produce usable Java records from the
3.1 document (the gate to stage 2 of decision #34)? *Done when:* a deliberately wrong response fails a test.

**0.5 Observability and CI.** *Do:* OpenTelemetry export to New Relic, Sentry; GitHub Actions
backend workflow (path filter, tests, Jib ARM64 image). *Done when:* a PR runs the suite and
produces an image.

## Phase I — Staging infrastructure

**I.1 Terraform bootstrap.** State bucket, GitHub OIDC role, ECR repository. *Done when:*
`terraform plan` runs from a PR.

**I.2 Network and compute.** VPC, public subnet, EC2 `t4g.small` with SSM, security group closed to
all but CloudFront, EBS data volume + DLM snapshots, Parameter Store layout with placeholders.
*Done when:* the instance is reachable through Session Manager and runs Compose.

**I.3 Edge.** Route 53 zone, ACM certificate, CloudFront `api.<domain>` with the origin header.
*Done when:* `https://api.<domain>/actuator/health` answers through CloudFront and the EC2 refuses
direct requests.

**I.4 Deploy pipeline.** Merge to `main` → image to ECR → SSM Run Command restarts Compose.
*Done when:* a merged change is live on staging without anyone logging in.

**I.5 Queues and media buckets.** SQS `notifications` + DLQ; S3 buckets (`incoming/`, `media`);
the ingest Lambda; CloudFront `img.<domain>` + the transform Lambda. *Done when:* an object PUT
through a presigned URL with a matching checksum appears as a master and serves a `card` variant.

## Phase S — Thin slice

*Read:* [auth.md](auth.md), [04](../product/04-lost-workflow.md), [media-pipeline.md](media-pipeline.md),
[api.md](api.md) · Gaps found by the backend review.

**S.0 Contract changes.** Landed on the client side (decisions #35, #36): the `device` cookie
([api.md](api.md) · Device identity) and the upload flow as slots — `POST /uploads` → presigned
PUT → URL ([api.md](api.md) · Uploads). *Do:* implement both against `openapi.json`; the emulated
bucket (`web/src/mocks/api/media.ts`) is the behaviour to match.

**S.1 Auth.** Email code (Resend), Google sign-in, session cookie, `GET /session`, sign-out,
`GET /config` from `supported_countries`.

**S.2 Phone step.** `POST /me/phone` + verify; SMS OTP over Twilio with the safety checklist of
[auth.md](auth.md) (Bucket4j limits, spend alarm); the `publisher_phone_otp` flag
([feature-flags.md](feature-flags.md)).

**S.3 Publish and view a lost case.** `POST /lost-cases`, `GET /cases/{code}` with the
publisher-only fields, `GET /feed` (newest first, as the contract says today).

**S.4 «Lo vi».** `POST /cases/{code}/sightings` with server-side validation, the `client_id` replay
key, rate limits keyed by the anonymous identity from S.0; photos through the upload flow.

**Done when (phase):** the client, built with `VITE_API_MOCK=false` against staging, passes its
sign-in, publish-lost and lost-case e2e specs.

## Phase L — The rest of Lost & Found

Each a step; order within the phase follows what the client needs next.

- **L.1 Outbox, relay and the notification worker** — [outbox-relay.md](outbox-relay.md), including
  its *To review at implementation* list; Web Push (VAPID) and email senders; inbox.
- **L.2 Claims** («Lo tengo», verdicts) and owner actions on sightings.
- **L.3 Follow-up loop** as db-scheduler jobs: check-ins, escalation, expiry, reopen window; the
  email one-tap links.
- **L.4 Nearby broadcast** — needs decided first: the radius and audience (no doc defines them
  yet), the per-recipient cap ([O2](../open-items.md)) and re-broadcast ([O1](../open-items.md)).
- **L.5 Found vertical** and matching v1 ([05](../product/05-found-workflow.md), [O7](../open-items.md)).
- **L.6 Chat** over Twilio Conversations ([comms.md](comms.md)).
- **L.7 Reporting and the operator queue** ([09](../product/09-reporting.md); staffing [O11](../open-items.md)).
- **L.8 Purges and account deletion** ([01](../product/01-actors-and-entities.md) rule 7, decision #28).
- **L.9 Reverse geocoding** for place names.

## Phase X — Production and launch

- **X.1 RDS.** Production database on RDS; restore drill performed once end to end.
- **X.2 Production environment.** Parameters, distributions and alarms for `prod`; the client's
  production build pointed at it.
- **X.3 Paid Plan.** Move the AWS account off the Free Plan before its 6 months end.
- **X.4 Launch checks.** Client e2e suite green against production; spend alarms
  ([costs.md](costs.md)); report queue staffed.

## Phase V — Adoption, then Help

The same pattern per vertical: contract already exists, implement and pass the client's specs —
[06](../product/06-adoption-workflow.md), then [07](../product/07-help-workflow.md).
