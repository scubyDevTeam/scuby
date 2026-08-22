# Product Map

> Founding document. Every decision here was argued and locked on 2026-08-01.
> Don't re-litigate without new evidence — the reasoning is recorded in the decision log below.

## Mission

Connect people who need help with a pet to the people nearby who can give it — starting with bringing lost pets home.

## The contract

**Side project, impact-first.** ~10–15 combined hours/week (two engineers, no clock, no revenue bar).

Success at month 12:
- Real reunions happening weekly
- Adoption listings flowing person-to-person, most of them born from found cases
- At least one vet clinic receiving earmarked help for a specific animal
- Revenue explicitly **not** a year-1 goal

> Amended 2026-08-22 (see decisions 12–13): adoption launches **P2P-only**, and the donations vertical
> is generalized into **help**. Foundations listing at scale (B2P) becomes a trigger, not a date.

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

### Phase 1 — Adoption, P2P only
One person rehoming one animal to another person: a listing, a light "Me interesa", a conversation, and a handoff that happens entirely off-platform. No contract, no verdict from us. See [06-adoption-workflow.md](06-adoption-workflow.md).

Inventory comes from the vertical we launch first — `converted_to_adoptable` turns found strays into listings published by individuals.

### Phase 2 — Adoption, B2P (trigger, not a date)
Foundations listing at scale, with the screening form and the ranked application inbox that replaces 40 «¿todavía está disponible?» chats. The seams are pre-wired in v1 (`lane`, `kind`, `form_data`, actor references, structured requirement flags), so this is enum values plus one view — never a migration.

**Triggers:** the adoption feed can't stay stocked from conversions alone, *or* a foundation asks for the inbox unprompted.

### Phase 2 — Help (supersedes "Donations")
Money is one need out of eight. `help_case` carries needs of any kind — funds, transport, foster, supplies, blood, rescue, vet access, hands — each one a pledge ledger confirmed by the beneficiary. Two numbers always: *confirmado* primary, *prometido* secondary. See [07-help-workflow.md](07-help-workflow.md).

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
| 8 | Adoption depth | Mediated contact; decision and handoff off-platform | Directory-only (zero value over an Instagram post); full pipeline with contracts (pulls legal into v1) |
| 9 | Legal posture | Intermediary ToS + Ley 1581 privacy policy, SAS deferred | Company-now (cost with zero revenue and minimal liability) |
| 10 | Matching v1 | Structured + geo scored candidates; photo similarity as parallel learning track | Photo-similarity-first (weeks of work, GPU cost, early bad matches erode trust) |
| 11 | Points | Status only for now | Designing a redemption economy before there's anything to redeem |
| 12 | Adoption launch shape *(2026-08-22)* | **P2P first, B2P seams pre-wired** | B2P-first (foundation onboarding is a cold start of its own, on top of Lost & Found's); P2P-only-forever (throws away the inbox that makes foundations list with us) |
| 13 | Donations vertical *(2026-08-22)* | **Generalized into Help** — money is one `need_kind` of eight | Money-only campaigns (transport, foster and blood become permanent bolt-ons); staying out of help entirely (it's the reason a pet-centric record is worth having) |
| 14 | Anonymous sighting contact *(2026-08-22)* | **Optional** — only the pin is required | Required contact (the report that never gets submitted is worth less than a bare pin) |

## Open questions

| # | Question | Where it's tracked |
|---|---|---|
| 1 | What actually triggers B2P adoption? | [06](06-adoption-workflow.md) q2 — feed can't stay stocked, or a foundation asks unprompted |
| 2 | Who staffs the report and suspension queues, at what SLA? | [04](04-lost-workflow_draft_1.md) q7 and [07](07-help-workflow.md) q4. An unstaffed report button promises action we don't take |
| 3 | Which clinic pilots `payout_target: clinic`? | [07](07-help-workflow.md) q3 — the cheapest fraud control we have, and it needs exactly one friendly vet |
