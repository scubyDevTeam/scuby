# Core Flows

## Lost & Found

The whole game: **maximize the eyeballs that see the pet in the first 48 hours, in the neighborhood where it was lost.**

### 1. Publish
One form: photos, species/breed/size/colors/marks, last-seen location (map pin) + time, optional reward, contact preference (expose WhatsApp/email or not). Requires an account (OAuth one-tap + phone verification). Behind the scenes: claimed Pet + `lost` Case.

### 2. Broadcast — three channels, in order of importance
1. **Geo push**: every opted-in user within ~2–5 km gets "🐕 Perro perdido cerca de ti" with photo. This is *the* differentiator — Facebook groups have no geo-targeting and posts drown in the feed.
2. **Geo feed**: the post appears for anyone browsing that zone, sorted by proximity + recency. Local-first, national fallback when the local feed is empty.
3. **Shareable card**: auto-generated image (photo, PERDIDO, zone, QR/link back) sized for WhatsApp statuses and IG stories. Virality in Colombia lives in WhatsApp — ride it; every share is an acquisition channel.

### 3. The neighborhood responds — two distinct actions
- **"Lo vi" (sighting)** — lightweight, no account needed: location + time + optional photo + optional contact number. Sightings pin onto a map on the post so the owner sees the trajectory ("moving toward the park"). Low commitment, high volume. Anti-spam: rate limiting + owner can hide pins.
- **"Lo tengo" (found/secured)** — opens direct contact with the owner (WhatsApp deep link if exposed; in-app message otherwise).

### 4. Matching (background)
Independently-posted `found` reports are compared against open `lost` cases: species, size, colors, marks, breed-guess × geo distance × time window → **scored candidate list** surfaced to *both* sides as "¿es tu mascota?". Mutual confirmation triggers the Pet merge (see entities doc).

**v2 (parallel AI-learning track):** photo-embedding similarity added as one more score into the same pipeline. Additive, never a rewrite. Known failure mode to design for: dirty/wet/injured pets photographed badly at night look nothing like their fluffy profile photo.

### 5. Resolve
Owner marks **reunited** (prompted to post the happy-ending photo — the platform's best organic marketing, and the moment to ask "who helped you?" for points attribution) or the case quietly expires. After resolution the owner owes the platform nothing.

## Adoption — P2P in v1

Depth decision: **mediated contact; decision and handoff off-platform.** Full detail in [06-adoption-workflow.md](06-adoption-workflow.md).

1. **A person lists a pet** — claimed Pet + `adoption` Case: photos, story, temperament, structured requirement flags, and a **mandatory fee disclosure including zero**. Most v1 inventory arrives via `converted_to_adoptable` from a found case.
2. **An interested person answers** — "Me interesa": a free message plus three one-tap chips («tengo patio», «tengo otros perros», «primera mascota»). Account required, always: they are receiving an animal, not helping.
3. **The publisher works a short list, not a chat thread** — open / shortlisted / accepted / declined / lapsed. Small in v1 by design, and deliberately the same surface B2P will sort and filter.
4. **Real world takes over** — meeting, questions, handoff, all off-platform. We rank evidence and warn; the publisher decides. We never approve an adopter.
5. **The publisher records the outcome** — `adopted` → responsibility link transfers → case resolves, and we ask who helped. The pet's history (found as a stray, treated, fostered) travels with it.

**Deferred to B2P** (Phase 2, trigger-driven): organization accounts, the shared screening form, the ranked filterable inbox, the public response-time label. The seams for all of it ship in v1.

## Help (Phase 2) — supersedes "Donations"

Money **never** touches the platform, and money is only one of eight needs. Full detail in [07-help-workflow.md](07-help-workflow.md).

1. **A help case carries needs** — `funds`, `transport`, `foster`, `supplies`, `blood`, `rescue`, `vet_access`, `hands`. Each need has a unit and an optional target; a case can have three at once.
2. **Helpers pledge; only the beneficiary confirms.** Every kind of help is the same ledger, which is all we could honestly know about an off-platform donation anyway.
3. **Two numbers, never one** — *confirmado* large and primary, *prometido* small and secondary. A single self-reported total is the scam's favourite instrument.
4. **Funds needs require evidence to publish** (diagnosis, invoice, or a vet we can call) and display a trust tier. The preferred `payout_target` is a **clinic**: you cannot steal a surgery.
5. **Updates are mandatory** — a real case produces a shaved leg and a discharge sheet week after week; a fake one produces silence.

## Cross-cutting: reporting, moderation & verification

- **`report`** — one table over every publication in every vertical. Anonymous, one tap, a reason required, rate-limited by device.
- **Reports never hide an active case by themselves.** If a stranger can silently suppress a case, a scammer or a spiteful neighbour can end one. Three carve-outs: `graphic_content` and `personal_data` auto-hide on the first report; a credible `scam_or_extortion` report on a `funds` case suspends it loudly, with an SLA.
- **`animal_welfare` on a found case** is the highest-priority queue — and the one report type where contacting the finder beats hiding the post.
- **Verification queue**: manual review of evidence (vet invoices, personería jurídica). Fine at low volume; revisit if it exceeds the side-project hour budget.
- An unstaffed report button is worse than none. Set the SLA before launch.
