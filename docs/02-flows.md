# Core Flows

## Lost & Found

The whole game: **maximize the eyeballs that see the pet in the first 48 hours, in the neighborhood where it was lost.**

> Summary only. Lost lives in [04-lost-workflow_draft_1.md](04-lost-workflow_draft_1.md); found,
> sightings, matching contract, and merge in [07-found-workflow_draft_1.md](07-found-workflow_draft_1.md);
> notifications in [05-notifications.md](05-notifications.md). Where this summary disagrees with
> those, they win.

### 1. Publish
One form: photos, species/breed/size/colors/marks, last-seen **area** (pin + a radius chip: ~1 cuadra / ~3 cuadras / ~1 km — the owner rarely knows the exact spot), time, contact preference (expose WhatsApp/email or not). No reward field, by design — people help because it's a lost pet. Requires an account (OAuth one-tap + phone verification). **Only the owner publishes Lost**; everyone else goes through «Encontré un animal», whose first question — «¿Lo tienes contigo?» — routes to a found case (custody) or a sighting (just saw it). Behind the scenes: claimed Pet (reused if the user already has one — «¿Cuál se perdió?») + owner link + `lost` Case, in one transaction.

### 2. Broadcast — three channels, in order of importance
1. **Geo push**: every opted-in user within ~2–5 km gets "🐕 Perro perdido cerca de ti" with photo. This is *the* differentiator — Facebook groups have no geo-targeting and posts drown in the feed.
2. **Geo feed**: the post appears for anyone browsing that zone, sorted by proximity + recency. Local-first, national fallback when the local feed is empty.
3. **Shareable card**: per-case link previews (`og:image`, server-rendered, status-aware) so a pasted link shows the pet; plus an on-device poster (square / story / print) with a QR to the short link. The image never changes; the page does. Virality in Colombia lives in WhatsApp — ride it; every share is an acquisition channel. See [10-sharing.md](10-sharing.md).

### 3. The neighborhood responds — two distinct actions
- **"Lo vi" (sighting)** — lightweight, no account needed: location + time + contact number (required, not verified) + optional photo. Sightings pin onto a map on the post so the owner sees the trajectory ("moving toward the park"); one reporter may file several, and nothing is deleted to make room — recency is shown, not enforced. Low commitment, high volume. Anti-spam: rate limiting + owner can hide pins, never pre-approval.
- **"Lo tengo" (found/secured)** — always creates a `recovery_claim` first (anonymous: phone required), *then* opens contact with the owner (WhatsApp deep link if exposed; in-app thread for registered users). The claim shows as a «posible hallazgo» badge and accelerates the owner's check-ins; it never resolves the case by itself — only the owner confirms.

### 4. Matching
Matches **pets, not cases**: identity first, then the pet's situation says what a report means. Runs at publish time on both sides and on every witness report — species, size, colors, marks, breed-guess × geo distance × time window → **candidate list with human-readable reasons**, always confirmed by a human, never auto-attached. A finder publishing custody is matched *before* a found case is created (a hit becomes a «lo tengo» claim on the lost case, no second card). A witness report that matches nothing is kept internally as an orphan sighting for 30 days and re-matched against lost cases published later. Mutual confirmation triggers the reversible Pet merge (see 07).

**v2 (parallel AI-learning track):** photo-embedding similarity added as one more score into the same pipeline. Additive, never a rewrite. Known failure mode to design for: dirty/wet/injured pets photographed badly at night look nothing like their fluffy profile photo.

### 5. Resolve
Owner marks **reunited** (prompted to post the happy-ending photo — the platform's best organic marketing, and the moment to ask «¿quién te ayudó?» for points attribution). Otherwise the platform check-ins keep asking, framed negatively («si no nos confirmas, archivaremos la publicación»), and two unanswered check-ins ≈ 14 days expire the case — softly, reopenable in one tap for 30 days. Only the owner ever sets reunited. After resolution the owner owes the platform nothing.

## Adoption

> Summary only. Source of truth: [08-adoption-workflow_draft_1.md](08-adoption-workflow_draft_1.md).

Depth decision: **listing vertical, not screening vertical — individuals first.** Foundations with their own process get a listing that links out; the ranked inbox is deferred until one of them moves their process to us.

1. **Anyone holding a pet lists it** — an owner rehoming, a rescuer, the found-flow custodian who can't keep the stray, or an org. Same pet row, whatever its custody state. A trust-tier badge (`verified` org / `individual`) with honest copy.
2. **Adopter taps «Me interesa»** — account required, a 4-field intro (housing, yard, other pets, why), then the channel opens: WhatsApp with the intro prefilled, the org's own application URL, or an in-app thread. The interest row exists before any conversation.
3. **Lister screens in chat**, sees a plain list of interests (no ranking), marks one as chosen, declines the rest silently if they want.
4. **Real world takes over** — meeting, handoff, per the lister's own judgment. We're the intermediary.
5. **Lister records the outcome** — adopted in-app (by whom → responsibility link transfers, pet's history travels with it) or off-platform (link closes, recorded honestly). Check-ins keep listings from going stale: per case for individuals, one monthly digest per org.

## Help (Phase 2)

> Summary only. Source of truth: [09-help-workflow_draft_1.md](09-help-workflow_draft_1.md).

Money **never** touches the platform — and neither do payment details. **Link, don't host.**

1. **Beneficiary who holds the pet creates a campaign on a crowdfunding platform** (Vaki or similar) — the form's first step sends them there if they don't have one — then pastes the link. One link, one request.
2. **Request attached to the Pet**: story, optional evidence (vet diagnosis/quote), optional goal. Trust tier displayed prominently: **unverified** (identity only, publishes immediately, clearly labeled) vs **verified** (operator reviewed evidence and link; personería jurídica for foundations).
3. **«Quiero ayudar» is a link-out.** Donors pay on the platform. «Ya ayudé» (account required) is the only record we keep — shown as a count of people, never a sum. Progress is self-reported by the beneficiary at each check-in, labeled as theirs.
4. **Check-ins keep it honest**: silence after the need ended is the fraud signal. Every request carries the report button; reports feed the moderation queue.

## Cross-cutting: moderation & verification (operator flows)

- **Verification queue**: manual review of evidence submissions (vet invoices, personería jurídica). Fine at low volume; revisit if it exceeds the side-project hour budget.
- **Report queue**: community flags on any post/campaign/sighting. First strike: hide + contact publisher. Scams: remove + ban.
