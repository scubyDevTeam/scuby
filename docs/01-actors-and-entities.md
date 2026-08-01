# Actors & Entities

## Actors

| Actor | What they are | Key actions |
|---|---|---|
| **Person** | The single individual account type | Report lost/found, report sightings, donate (off-platform), apply to adopt, share, flag |
| **Organization** | Verified entity — foundations first; vets/shelters later | List adoptable pets, review applications, run campaigns, hold pets |
| **Anonymous visitor** | No account (typically arrived via a WhatsApp share) | View posts, contact an owner, report sightings |
| **Operators** | The founders, for now | Verification review, moderation queue, foundation onboarding |

Roles are **contextual, not account types**: the same person is an "owner" when their dog goes missing, a "helper" when they report a sighting. Nothing is chosen at signup.

## The anonymity ladder

From least to most identity required:

| Action | Identity required | Rationale |
|---|---|---|
| View posts, share cards | None | Reach must be frictionless |
| Report a sighting | None — location + time + optional photo + *optional* contact number | The map pin is the value; a contact field just enables follow-up questions. Anti-spam via rate-limiting and owner-hides-pin, not signup |
| "I have it" / contact owner | None — opens owner's WhatsApp (owner opts into exposing it) | Helping needs no account |
| **Publish** anything (lost, found, campaign) | Account (OAuth: Google/Apple one-tap) + phone verification | A publisher must be contactable and accountable |
| Apply to adopt | Account, always | The foundation needs a real identity to screen |
| Earn points / status | Account | Attribution requires identity |

## Core entity model: Pet + Case

The pet is the durable record; situations that need help are **Cases** attached to it.

```
Person / Organization
      │  responsibility link (owner | custodian | org) — TRANSFERABLE
      ▼
     Pet ── species, breed-guess, size, colors, marks, photos, chip #
      │     state: claimed | unclaimed | org-held
      │
      ├── Case: LOST         last-seen pin + time, reward?     → reunited | expired
      ├── Case: FOUND        found-location, holding?          → reunited | transferred-to-org | expired
      ├── Case: ADOPTABLE    requirements, applications        → adopted | withdrawn
      └── Case: FUNDRAISING  goal, story, evidence, payee info → closed
```

### Why pet-centric (recorded so we don't re-litigate)

The verticals demonstrably involve the same animals: a found stray becomes adoptable; an adopted dog later needs a vet fund. Post-per-vertical models throw that connection away and require retrofitting pet identity later. The continuity is the product — it's what Facebook groups structurally cannot do, it's what matching operates on, and every Phase 3+ social feature (meet & greets, pet profiles) needs durable pet records.

### The rules that make it work

1. **Case-first UX.** Users never "create a pet profile." They tap *Report lost pet* / *I found a pet* / *List for adoption* and fill one form; the Pet row is created underneath as a side effect. Profiles are enrichment, never a prerequisite.
2. **Responsibility is a link, not a property.** Ownership/custody is a relation between a person/org and a pet, so it can transfer. **An adoption is exactly a responsibility transfer** — the pet record and its history survive the handoff.
3. **Unclaimed pets are normal.** A finder creates an unclaimed Pet (they're marked custodian, not owner). Someone has to hold the photos and traits of that animal — the record exists precisely so the real owner can claim it.
4. **Merge is a first-class, reversible operation.** When a found-report and a lost-report are confirmed to be the same animal, the unclaimed record folds into the claimed Pet and both cases resolve as *reunited*. Wrong merges must be undoable. This is the trickiest flow in the system and the price of the model.
5. **Dormant records cost nothing.** After a case resolves, nobody owes the platform maintenance. Rows just sit there until (if ever) their human enriches them.
