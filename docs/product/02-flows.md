# Core Flows

## Lost & Found

The whole game: **maximize the eyeballs that see the pet in the first 48 hours, in the neighborhood where it was lost.**

> Summary only. Lost lives in [04-lost-workflow.md](04-lost-workflow.md); found,
> sightings, matching contract, and merge in [05-found-workflow.md](05-found-workflow.md);
> notifications in [08-notifications.md](08-notifications.md). Where this summary disagrees with
> those, they win.

### 1. Publish
One form: photos, species/breed/size/colors/marks, last-seen **area** (pin + a radius chip: ~1 cuadra / ~3 cuadras / ~1 km — the owner rarely knows the exact spot), time, contact preference (expose WhatsApp/email or not). No reward field, by design — people help because it's a lost pet. Requires an account (OAuth one-tap + phone verification). **Only the owner publishes Lost**; everyone else goes through «Encontré un animal», whose first question — «¿Lo tienes contigo?» — routes to a found case (custody) or a sighting (just saw it). Behind the scenes: claimed Pet (reused if the user already has one — «¿Cuál se perdió?») + owner link + `lost` Case, in one transaction.

### 2. Broadcast — three channels, in order of importance
1. **Geo push**: every opted-in user within ~2–5 km gets "🐕 Perro perdido cerca de ti" with photo. This is *the* differentiator — Facebook groups have no geo-targeting and posts drown in the feed.
2. **Geo feed**: the post appears for anyone browsing that zone, sorted by proximity + recency. Local-first, national fallback when the local feed is empty.
3. **Shareable card**: per-case link previews (`og:image`, server-rendered, status-aware) so a pasted link shows the pet; plus an on-device poster (square / story / print) with a QR to the short link. The image never changes; the page does. Virality in Colombia lives in WhatsApp — ride it; every share is an acquisition channel. See [10-sharing.md](10-sharing.md).

### 3. The neighborhood responds — two distinct actions
- **"Lo vi" (sighting)** — lightweight, no account needed: **only the pin required**; time defaults to now, photo/note/contact optional (asked for, explained, never gated — decision #13). Sightings pin onto a map on the post so the owner sees the trajectory ("moving toward the park"); one reporter may file several, and nothing is deleted to make room — recency is shown, not enforced. Low commitment, high volume. Anti-spam: owner can hide pins + moderation, never pre-approval; rate limits are deferred until real patterns are seen (decision #54).
- **"Lo tengo" (found/secured)** — needs a session, and always creates a `recovery_claim` first (phone required), *then* opens contact with the owner (WhatsApp deep link if exposed; in-app thread for registered users). The claim shows as a «posible hallazgo» badge to the owner only and accelerates the owner's check-ins; it never resolves the case by itself — only the owner confirms.

### 4. Matching
Matches **pets, not cases**: identity first, then the pet's situation says what a report means. Runs at publish time on both sides and on every witness report — species, size, colors, marks, breed-guess × geo distance × time window → **candidate list with human-readable reasons**, always confirmed by a human, never auto-attached. A finder publishing custody is matched *before* a found case is created (a hit becomes a «lo tengo» claim on the lost case, no second card). A witness report that matches nothing is kept internally as an orphan sighting for 30 days and re-matched against lost cases published later. Mutual confirmation triggers the reversible Pet merge (see 05).

**v2 (parallel AI-learning track):** photo-embedding similarity added as one more score into the same pipeline. Additive, never a rewrite. Known failure mode to design for: dirty/wet/injured pets photographed badly at night look nothing like their fluffy profile photo.

### 4b. The found side — custody with a deadline
A found case runs on **two clocks**: check-ins («¿sigues con él?», T+48h then every 5 days — is the post still true?) and a **hold clock** — at day 15 unclaimed, the product offers the exit: publish in adoption (pre-filled, same pet — the primary source of P2P adoption inventory), hand to a foundation, keep it, or keep searching. «Es mío» claims are registered-only and arrive with an evidence ladder (a prior lost case, timestamp-proven, is the strongest; the finder's withheld detail is the shibboleth). We rank evidence and warn; the finder decides. See [05-found-workflow.md](05-found-workflow.md).

### 5. Resolve
Owner marks **reunited** (prompted to post the happy-ending photo — the platform's best organic marketing, and the moment to ask «¿quién te ayudó?» for points attribution). Otherwise the platform check-ins keep asking, framed negatively («si no nos confirmas, archivaremos la publicación»), and two unanswered check-ins ≈ 14 days expire the case — softly, reopenable in one tap for 30 days. Only the owner ever sets reunited. After resolution the owner owes the platform nothing.

## Adoption

> Summary only. Source of truth: [06-adoption-workflow.md](06-adoption-workflow.md).

Depth decision: **listing vertical, not screening vertical — individuals first.** Foundations with their own process get a listing that links out; the ranked inbox is deferred until one of them moves their process to us.

1. **Anyone holding a pet lists it** — an owner rehoming, a rescuer, the found-flow custodian who can't keep the stray, or an org. Same pet row, whatever its custody state. A trust-tier badge (`verified` org / `individual`) with honest copy.
2. **Adopter taps «Me interesa»** — account required, a 4-field intro (housing, yard, other pets, why), then the channel opens: WhatsApp with the intro prefilled, the org's own application URL, or an in-app thread. The interest row exists before any conversation.
3. **Lister screens in chat**, sees a plain list of interests (no ranking), marks one as chosen, declines the rest silently if they want.
4. **Real world takes over** — meeting, handoff, per the lister's own judgment. We're the intermediary.
5. **Lister records the outcome** — adopted in-app (by whom → responsibility link transfers, pet's history travels with it) or off-platform (link closes, recorded honestly). Check-ins keep listings from going stale: per case for individuals, one monthly digest per org.

## Help (Phase 2)

> Summary only. Source of truth: [07-help-workflow.md](07-help-workflow.md).

**Help in kind, never money** — no amounts, no campaign links, no account numbers.

1. **Beneficiary who holds the pet asks for 1–3 needs**: `foster` (a temporary home), `transport` (a ride, usually to the vet), `supplies` (food, a crate, medicine bought in kind) — each with what exactly, how many, by when — plus the area and the story.
2. **Request attached to the Pet**, shown by proximity. Trust tier displayed prominently: **unverified** (identity only, publishes immediately, clearly labeled) vs **verified** (operator reviewed who is asking; personería jurídica for foundations).
3. **«Yo ayudo» is a pledge** (account and a reachable phone required) that opens the channel to the beneficiary. **Only the beneficiary marks it received**; progress shows *confirmado* first, *prometido* second.
4. **Check-ins close it**: when every need is covered or the need ended. Every request carries the report button; a request asking for money is closed as out of scope.

## Cross-cutting: moderation & verification (operator flows)

- **Verification queue**: manual review of evidence submissions (vet invoices, personería jurídica). Fine at low volume; revisit if it exceeds the side-project hour budget.
- **Report queue**: anonymous one-tap reports on any publication, one table across verticals — rules, reasons, auto-hide exceptions and queue mechanics in [09-reporting.md](09-reporting.md). An unstaffed report button is worse than none: the SLA is set before launch (O11).
