# Core Flows

## Lost & Found

The whole game: **maximize the eyeballs that see the pet in the first 48 hours, in the neighborhood where it was lost.**

> Summary only. The lost flow's entities, state machine, follow-up loop, and rules live in
> [04-lost-workflow_draft_1.md](04-lost-workflow_draft_1.md); notifications in
> [05-notifications.md](05-notifications.md). Where this summary disagrees with those, they win.

### 1. Publish
One form: photos, species/breed/size/colors/marks, last-seen **area** (pin + a radius chip: ~1 cuadra / ~3 cuadras / ~1 km — the owner rarely knows the exact spot), time, contact preference (expose WhatsApp/email or not). No reward field, by design — people help because it's a lost pet. Requires an account (OAuth one-tap + phone verification). **Only the owner publishes Lost**; a neighbor who saw a stray or took one in publishes Found. Behind the scenes: claimed Pet (reused if the user already has one — «¿Cuál se perdió?») + owner link + `lost` Case, in one transaction.

### 2. Broadcast — three channels, in order of importance
1. **Geo push**: every opted-in user within ~2–5 km gets "🐕 Perro perdido cerca de ti" with photo. This is *the* differentiator — Facebook groups have no geo-targeting and posts drown in the feed.
2. **Geo feed**: the post appears for anyone browsing that zone, sorted by proximity + recency. Local-first, national fallback when the local feed is empty.
3. **Shareable card**: auto-generated image (photo, PERDIDO, zone, QR/link back) sized for WhatsApp statuses and IG stories. Virality in Colombia lives in WhatsApp — ride it; every share is an acquisition channel.

### 3. The neighborhood responds — two distinct actions
- **"Lo vi" (sighting)** — lightweight, no account needed: location + time + contact number (required, not verified) + optional photo. Sightings pin onto a map on the post so the owner sees the trajectory ("moving toward the park"); one reporter may file several, and nothing is deleted to make room — recency is shown, not enforced. Low commitment, high volume. Anti-spam: rate limiting + owner can hide pins, never pre-approval.
- **"Lo tengo" (found/secured)** — always creates a `recovery_claim` first (anonymous: phone required), *then* opens contact with the owner (WhatsApp deep link if exposed; in-app thread for registered users). The claim shows as a «posible hallazgo» badge and accelerates the owner's check-ins; it never resolves the case by itself — only the owner confirms.

### 4. Matching (background)
Independently-posted `found` reports are compared against open `lost` cases: species, size, colors, marks, breed-guess × geo distance × time window → **scored candidate list** surfaced to *both* sides as "¿es tu mascota?". Mutual confirmation triggers the Pet merge (see entities doc).

**v2 (parallel AI-learning track):** photo-embedding similarity added as one more score into the same pipeline. Additive, never a rewrite. Known failure mode to design for: dirty/wet/injured pets photographed badly at night look nothing like their fluffy profile photo.

### 5. Resolve
Owner marks **reunited** (prompted to post the happy-ending photo — the platform's best organic marketing, and the moment to ask «¿quién te ayudó?» for points attribution). Otherwise the platform check-ins keep asking, framed negatively («si no nos confirmas, archivaremos la publicación»), and two unanswered check-ins ≈ 14 days expire the case — softly, reopenable in one tap for 30 days. Only the owner ever sets reunited. After resolution the owner owes the platform nothing.

## Adoption

Depth decision: **structured application, decision off-platform.**

1. **Foundation lists a pet** — org-held Pet + `adoptable` Case: photos, temperament, requirements.
2. **Adopter applies in-app** — shared base screening form (housing, experience, household, other pets). Account required, always.
3. **Foundation works a ranked, filterable application inbox** instead of 40 "¿todavía está disponible?" WhatsApp chats. Accept/reject/shortlist in-app. *This inbox is the reason foundations list with us.*
4. **Real world takes over** — interviews, home visit, handoff happen off-platform, per the foundation's own process.
5. **Foundation records the outcome** — adopted (by whom) → responsibility link transfers to the adopter → case resolves. The pet's history (found as a stray, fostered, funded) travels with it.

## Donations (Phase 2)

Money **never** touches the platform.

1. Campaign attached to a Pet: goal, story, evidence (vet diagnosis/invoice), beneficiary's own payment info (Nequi/Daviplata/bank/link).
2. Trust tier displayed prominently: **unverified** (basic identity only — clearly labeled) vs **verified** (evidence reviewed; personería jurídica for foundations).
3. Donors pay the beneficiary directly. Raised totals are self-reported by the campaign owner.
4. Every campaign carries a report/flag button; reports feed the moderation queue.

## Cross-cutting: moderation & verification (operator flows)

- **Verification queue**: manual review of evidence submissions (vet invoices, personería jurídica). Fine at low volume; revisit if it exceeds the side-project hour budget.
- **Report queue**: community flags on any post/campaign/sighting. First strike: hide + contact publisher. Scams: remove + ban.
