# Product Map

> Founding document. Every decision here was argued and locked on 2026-08-01.
> Don't re-litigate without new evidence — the reasoning is recorded in the decision log below.

## Mission

Connect people who need help with a pet to the people nearby who can give it — starting with bringing lost pets home.

## The contract

**Side project, impact-first.** ~10–15 combined hours/week (two engineers, no clock, no revenue bar).

Success at month 12:
- Real reunions happening weekly
- Foundations actively listing adoptable pets
- Revenue explicitly **not** a year-1 goal

Photo-similarity AI is a first-class **learning** track, not a launch dependency.

## Principles

1. **Build wide, launch narrow.** The data model supports all three verticals from day one; the public push starts with Lost & Found. Foundation adoption listings are day-one inventory so the app never feels empty.
2. **Money never touches the platform.** Donation campaigns display the beneficiary's own Nequi/Daviplata/bank details; donors pay them directly. We are a bulletin board, not a bank.
3. **Trust is tiered, not gated.** Basic identity (phone/email) is enough to publish. A **Verified badge** requires evidence — vet invoice for individuals, personería jurídica for foundations — manually reviewed. Community reporting is the safety net under everything.
4. **One person account, contextual roles.** "Owner" and "helper" are things you *do*, not account types. Foundations (later: vets, shelters) are Organization accounts.
5. **Helping must not require an account; recognition does.** Contact and sightings work without signup; points/reputation accrue only for attributable in-app actions.
6. **Mission-first economics.** Free for everyone. Future revenue only from non-extractive sources (optional tips, sponsors, org tooling) — never a cut of sick-pet donations.

## Verticals, phased

### Phase 1 — Lost & Found (the growth engine)
Geo-targeted push notifications, sighting map, shareable WhatsApp/IG cards, structured matching. This is the high-urgency, high-emotion, zero-money vertical that earns users and trust. See [02-flows.md](02-flows.md).

### Phase 1 — Adoption (the inventory engine)
Foundations list pets; adopters submit structured in-app applications; decision and handoff happen off-platform. The pitch to foundations: a ranked application inbox instead of 40 WhatsApp chats.

### Phase 2 — Donations (unlocked once trust exists)
Campaigns attached to a pet: goal, story, evidence, beneficiary's payment info. Trust-tier labels displayed prominently. Totals self-reported (money is off-platform).

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
| 8 | Adoption depth | Structured application, decision off-platform | Directory-only (zero value over foundation's Instagram); full pipeline with contracts (pulls legal into v1) |
| 9 | Legal posture | Intermediary ToS + Ley 1581 privacy policy, SAS deferred | Company-now (cost with zero revenue and minimal liability) |
| 10 | Matching v1 | Structured + geo scored candidates; photo similarity as parallel learning track | Photo-similarity-first (weeks of work, GPU cost, early bad matches erode trust) |
| 11 | Points | Status only for now | Designing a redemption economy before there's anything to redeem |

## Open questions

None blocking. Future decisions live in Phase 3+ ideas and the points economy.
