# Product Map

> Founding document. Every decision here was argued and locked on 2026-08-01.
> Don't re-litigate without new evidence — the reasoning is recorded in the decision log below.

## Mission

Connect people who need help with a pet to the people nearby who can give it — starting with bringing lost pets home.

## The contract

**Side project, impact-first.** ~10–15 combined hours/week (two engineers, no clock, no revenue bar).

Success at month 12:
- Real reunions happening weekly
- Adoption listings flowing person-to-person, most born from found-case conversions
- Revenue explicitly **not** a year-1 goal

Photo-similarity AI is a first-class **learning** track, not a launch dependency.

## Principles

1. **Build wide, launch narrow.** The data model supports all three verticals from day one; the public push starts with Lost & Found. Adoption inventory comes from the vertical we launch first — found cases converting to listings at the day-15 offer ([05](05-found-workflow.md)) — so the app never feels empty without foundation onboarding.
2. **Money never touches the platform.** Donation campaigns display the beneficiary's own Nequi/Daviplata/bank details; donors pay them directly. We are a bulletin board, not a bank.
3. **Trust is tiered, not gated.** Basic identity (phone/email) is enough to publish. A **Verified badge** requires evidence — vet invoice for individuals, personería jurídica for foundations — manually reviewed. Community reporting is the safety net under everything.
4. **One person account, contextual roles.** "Owner" and "helper" are things you *do*, not account types. Foundations (later: vets, shelters) are Organization accounts.
5. **Helping must not require an account; recognition does.** Contact and sightings work without signup; points/reputation accrue only for attributable in-app actions.
6. **Mission-first economics.** Free for everyone. Future revenue only from non-extractive sources (optional tips, sponsors, org tooling) — never a cut of sick-pet donations.
7. **Colombia-first, never Colombia-only.** Country specifics — phone prefixes, currency, legal posture, launch copy — live in configuration (`supported_countries`, [eng/auth.md](../eng/auth.md)) and per-country docs, never in code or schema. v1 enables one country.

## Verticals, phased

### Phase 1 — Lost & Found (the growth engine)
Geo-targeted push notifications, sighting map, shareable WhatsApp/IG cards, structured matching. This is the high-urgency, high-emotion, zero-money vertical that earns users and trust. See [02-flows.md](02-flows.md).

### Phase 1 — Adoption (the inventory engine)
Anyone holding a pet lists it — individuals first, foundations link out to their own process. Adopters tap «Me interesa» with a short intro; screening happens in chat; the outcome is a responsibility transfer. The ranked inbox is deferred until a foundation moves its process to us. See [06](06-adoption-workflow.md).

### Phase 2 — Help (money first; unlocked once trust exists)
A request attached to a pet that **links out** to a campaign on a crowdfunding platform (Vaki or similar) — we never display payment details. Story, optional evidence, trust-tier label, self-reported progress kept honest by check-ins. `kind = money` now; foster/transport/supplies fit the same entity later. See [07](07-help-workflow.md).

### Phase 3+ — parked ideas
Helper points redemption economy · pet social features (meet & greets, gatherings) · foster-home network · transport volunteers · vet directory · microchip registry · public "happy endings" feed.

## Geography

App is **nationwide** from day one. Feeds are **local-first with national fallback** (an empty municipality feed redirects to the national filter). Outreach effort goes wherever the founders' networks actually reach — de facto concentration, no formal geo commitment.

## Decision log

| # | Decision | Chosen | Rejected alternatives & why |
|---|---|---|---|
| 1 | Launch scope | Build wide, launch Lost & Found first | All-three-at-once (three simultaneous cold-starts); adoption-first (low frequency, drags legal in early) |
| 2 | Business model | Mission-first, monetize later | % cut of donations (reputational landmine); B2B foundations-pay (they're broke) |
| 3 | Money flow | Platform never touches money | Escrow/processing (requires company, processor, fraud liability); pay-the-vet (needs clinic partnerships) |
| 4 | Trust model | Tiered verification + community reporting | Hard gate (review bottleneck blocks urgent cases); open publishing alone (one viral scam kills the brand) |
| 5 | Actor model | One person account + org accounts | Roles-at-signup (wrong-door friction, blocks cross-role actions) |
| 6 | Core entity | Pet + Case (see [01-actors-and-entities.md](01-actors-and-entities.md)) | Post-per-vertical (loses cross-vertical continuity, contradicts build-wide); embedded-with-optional-profile (two storage shapes, perpetual migration) |
| 7 | Contact | WhatsApp/email without account + optional registered identity for attribution | In-app-chat-only (loses helpers at the most time-critical moment) |
| 8 | Adoption depth | Listing + 4-field intro before contact; screening in chat; outcome recorded as a responsibility transfer; inbox deferred (revised 2026-08-22, see [06](06-adoption-workflow.md)) | Directory-only (zero value over foundation's Instagram); full pipeline with contracts (pulls legal into v1); ranked inbox now (foundations have their own process; individuals are the first users) |
| 12 | Client | PWA first → Capacitor shell → native rewrite under the same bundle ID (see [frontend.md](../eng/frontend.md)) | Native first (two surfaces, install friction, doesn't ship at 10–15 h/week) |
| 13 | Anonymous sighting contact *(2026-08-23)* | **Optional — only the pin is required**; asked for with explanatory copy, measured via `has_contact` | Required contact (the report that never gets submitted is worth less than a bare pin). The anonymous «Lo tengo» phone stays required — a claim's value IS the contact channel |
| 14 | Rewards on lost cases *(2026-08-23, reaffirmed)* | **No reward field, by design** — people help because it's a lost pet; free text in the description stays the owner's | Display-only field + warning copy (invites fake «lo tengo» claims, makes the platform read as a marketplace) |
| 15 | Abuse reporting *(2026-08-23)* | Anonymous one-tap `report` across all verticals; never auto-hides an active case except `graphic_content` / `personal_data`; SLA set before launch (see [09-reporting.md](09-reporting.md)) | Account-required reporting (abuse goes unreported); report-count auto-takedowns (a spiteful neighbor could end a real search) |
| 16 | Auth *(2026-08-23)* | **Google one-tap + email 6-digit code; no passwords ever.** Phone is not a login: collected + SMS-OTP-verified once at first publish, prefilled + «cambiar» thereafter, re-verified on change; unverified helper numbers format-validated and rendered actionable. DIY OTP over raw SMS with the safety checklist ([eng/auth.md](../eng/auth.md)) | Email+password (same email infra for resets, plus hashing, breach liability, support tax); phone-as-login (recurring SMS cost, pumping surface); Twilio Verify by default (\$0.05/verification for machinery the flows already build — named escape hatch instead); Facebook/Apple now (deferred with triggers) |
| 9 | Legal posture | Intermediary ToS + Ley 1581 privacy policy, SAS deferred | Company-now (cost with zero revenue and minimal liability) |
| 10 | Matching v1 | Structured + geo scored candidates; photo similarity as parallel learning track | Photo-similarity-first (weeks of work, GPU cost, early bad matches erode trust) |
| 11 | Points | Status only for now | Designing a redemption economy before there's anything to redeem |

## Open questions

None blocking. Future decisions live in Phase 3+ ideas and the points economy.

| 17 | Comms stack *(2026-08-27)* | Orchestration always ours (ladders, quiet hours, coalescing — providers are dumb pipes). `wa.me`/`mailto:` primary contact; **Twilio Conversations** as the number-free fallback chat (lazy creation, close-don't-remove, first 200 MAU free); Resend-class email → SES on volume; launch ladder push → email, claims push-only with the +24h check-in net; SMS only for publisher OTP ([eng/comms.md](../eng/comms.md), [eng/costs.md](../eng/costs.md)) | DIY threads (subsystem + ghost-town risk for a fallback); SMS in ladders (recurring spend on unresponsive users); WhatsApp templates now (needs the deferred WABA) |
| 18 | Feature flags *(2026-09-30)* | **Own tables, one server-side function:** global default + per-account override, every flip kept in a history table, every flag registered with an owner and an exit; flags gate behavior, never schema; **evaluated only in the backend**, invisible to the frontend, which receives outcomes as response data. First flag: `publisher_phone_otp` (default on) ([eng/feature-flags.md](../eng/feature-flags.md)) | Hosted flag service (vendor + SDK + bill for a few tables' worth of need); env vars / config file (global only, flip needs a deploy); percentage rollouts now (no traffic that needs them); client-side evaluation (logic in two places, flag removal tied to FE releases) |
