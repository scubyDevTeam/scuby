# Actors & Entities

## Actors

| Actor | What they are | Key actions |
|---|---|---|
| **Person** | The single individual account type | Report lost/found, report sightings, publish and answer adoption listings, publish help cases, pledge help, share, report abuse |
| **Organization** | Verified entity — foundations first; **vets** and shelters later | Hold pets, receive custody, be a help beneficiary. *Listing for adoption and the application inbox arrive with B2P — see [06](06-adoption-workflow.md)* |
| **Anonymous visitor** | No account (typically arrived via a WhatsApp share) | View posts, contact a publisher, report sightings, report abuse, donate |
| **Operators** | The founders, for now | Verification review, moderation queue, foundation onboarding |

Roles are **contextual, not account types**: the same person is an "owner" when their dog goes missing, a "helper" when they report a sighting. Nothing is chosen at signup.

## The anonymity ladder

From least to most identity required:

| Action | Identity required | Rationale |
|---|---|---|
| View posts, share cards | None | Reach must be frictionless |
| Report a sighting | None — **only the pin is required**; time, photo, note and contact are all optional | The map pin is the value. The report that never gets submitted is worth less than a bare pin. Anti-spam via rate-limiting and owner-hides-pin, not signup |
| Report a publication (abuse) | None — one tap + a reason | Requiring an account to report abuse means abuse goes unreported |
| "I have it" / contact a publisher | None — opens their WhatsApp (they opt into exposing it) | Helping needs no account |
| Donate / pledge money | None | Donating never requires an account. Attribution and points do |
| **Publish** anything (lost, found, adoption, help) | Account (OAuth: Google/Apple one-tap) + phone verification | A publisher must be contactable and accountable |
| Publish a `funds` need | Account **+ attached evidence** | The one hard publish gate in the product. A fake lost case wastes attention; a fake funds case takes money |
| Claim ownership of a found pet | Account, always | They are asking to *take* an animal, not to help |
| Answer an adoption listing | Account, always | The publisher is handing over an animal; they get to know who is asking |
| Earn points / status | Account | Attribution requires identity |

## Core entity model: Pet + Case

The pet is the durable record; situations that need help are **Cases** attached to it.

```
Person / Organization
      │  responsibility link (owner | custodian | org) — TRANSFERABLE
      ▼
     Pet ── species, breed-guess, size, colors, marks, photos, chip #
      │     custody_state: claimed | unclaimed | org_held
      │     health_flags[]  ── durable, survives every case
      │
      ├── Case: LOST      last-seen pin + time, reward?   → reunited | expired | cancelled
      ├── Case: FOUND     found-location, two clocks      → reunited | closed | expired
      ├── Case: ADOPTION  requirements, requests, fee     → adopted | closed | expired
      └── Case: HELP      needs[] + pledges + evidence    → resolved | closed | expired | suspended

Cross-cutting: report (any publication, anonymous, one tap)
               case_checkin (every vertical, different lever per vertical)
```

Every case shares the same four-status discipline — `active` plus terminal states, with `expired`
always reversible. HELP is the one exception, carrying a fifth (`suspended`), and
[07](07-help-workflow.md) argues for it explicitly.

### Why pet-centric (recorded so we don't re-litigate)

The verticals demonstrably involve the same animals: a found stray becomes adoptable; an adopted dog later needs a vet fund. Post-per-vertical models throw that connection away and require retrofitting pet identity later. The continuity is the product — it's what Facebook groups structurally cannot do, it's what matching operates on, and every Phase 3+ social feature (meet & greets, pet profiles) needs durable pet records.

The bridges this buys, all already expressible: `found → adoptable` (same pet, `successor_case_id`), `lost ↔ found` (mutual confirmation → merge), `rescue → found` (someone secures the animal), `found/adoption → help` (`health_flags`), and `adopted → the adopter is now the owner`, so if the pet goes missing a month later they publish a lost case with no special casing at all.

### The rules that make it work

1. **Case-first UX.** Users never "create a pet profile." They tap *Report lost pet* / *I found a pet* / *List for adoption* and fill one form; the Pet row is created underneath as a side effect. Profiles are enrichment, never a prerequisite.
2. **Responsibility is a link, not a property.** Ownership/custody is a relation between a person/org and a pet, so it can transfer. **An adoption is exactly a responsibility transfer** — the pet record and its history survive the handoff.
3. **Unclaimed pets are normal.** A finder creates an unclaimed Pet (they're marked custodian, not owner). Someone has to hold the photos and traits of that animal — the record exists precisely so the real owner can claim it.
4. **Merge is a first-class, reversible operation.** When a found-report and a lost-report are confirmed to be the same animal, the unclaimed record folds into the claimed Pet and both cases resolve as *reunited*. Wrong merges must be undoable. This is the trickiest flow in the system and the price of the model.
5. **Dormant records cost nothing.** After a case resolves, nobody owes the platform maintenance. Rows just sit there until (if ever) their human enriches them.
