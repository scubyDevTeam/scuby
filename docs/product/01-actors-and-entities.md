# Actors & Entities

## Actors

| Actor | What they are | Key actions |
|---|---|---|
| **Person** | The single individual account type | Report lost/found, report sightings, offer help in kind (a home, a ride, supplies), show interest in adopting, share, flag |
| **Organization** | Verified entity — foundations first; vets/shelters later | List adoptable pets, review applications, ask for help, hold pets |
| **Anonymous visitor** | No account (typically arrived via a WhatsApp share) | View posts, contact an owner, report sightings |
| **Operators** | The founders, for now | Verification review, moderation queue, foundation onboarding |

Roles are **contextual, not account types**: the same person is an "owner" when their dog goes missing, a "helper" when they report a sighting. Nothing is chosen at signup.

## The anonymity ladder

From least to most identity required:

| Action | Identity required | Rationale |
|---|---|---|
| View posts, share cards | None | Reach must be frictionless |
| Report a sighting | None — **only the pin is required**; time, photo, note and contact are all optional. Exception: a witness report with no case to attach to (orphan) requires a **photo** — unmatchable without one ([05](05-found-workflow.md)) | The pin is the value; the report that never gets submitted is worth less than a bare pin. Contact is asked for and its value explained, never gated. No OTP. Anti-spam via owner-hides-pin and moderation, not signup; rate limits are deferred until real patterns are seen ([decision #54](00-product-map.md)) |
| Report a publication (abuse) | None — one tap + a reason ([09-reporting.md](09-reporting.md)) | Requiring an account to report abuse means abuse goes unreported |
| "I have it" / contact owner | None — phone number (required, not verified) → a `recovery_claim` row → owner's WhatsApp (owner opts into exposing it) | Helping needs no account, but the claim must exist in the system *before* the WhatsApp handoff or the most common path to a reunion is invisible to badges, check-ins, and attribution |
| **Publish** anything (lost, found, adoption, help) | Account (Google one-tap or email code — no passwords, [eng/auth.md](../eng/auth.md)) + phone verified once at first publish | A publisher must be contactable and accountable. **Lost is published only by the owner** (ownership asserted, not verified); **Found only by someone holding the animal**. Seeing a stray is a sighting, not a publish — no account |
| «Me interesa» (adoption) | Account, always — plus a 4-field intro before the channel opens | Adopting is a commitment, not a tip; the hand-off transfers responsibility to a real person. Screening itself happens in chat, between them |
| Claim ownership of a found pet («es mío») | Account, always — plus the evidence form ([05](05-found-workflow.md)) | They are asking to *take* an animal, not to help |
| «Yo ayudo» on a help request | Account + a reachable phone | A foster we can't reach is not a foster; only the beneficiary confirms what arrived |
| Earn points / status | Account | Attribution requires identity |

## Core entity model: Pet + Case

The pet is the durable record; situations that need help are **Cases** attached to it.

```
Person / Organization
      │  responsibility link (owner | custodian | org) — TRANSFERABLE
      ▼
     Pet ── species, breed-guess, size, colors, marks, photos, chip #
      │     custody_state: claimed | unclaimed | org_held
      │     health_flags[] ── durable, survives every case (see 06)
      │
      ├── Case: LOST         last-seen area (point + radius) + time   → reunited | expired | cancelled
      ├── Case: FOUND        found-area + time, custody, two clocks   → reunited | kept | converted-to-adoptable | transferred-to-org | expired | cancelled
      ├── Case: ADOPTION     story, temperament, interests       → adopted | withdrawn | expired
      └── Case: HELP         needs in kind (foster · transport · supplies), pledges → closed | expired | removed
```

### Why pet-centric (recorded so we don't re-litigate)

The verticals demonstrably involve the same animals: a found stray becomes adoptable; an adopted dog later needs a vet fund. Post-per-vertical models throw that connection away and require retrofitting pet identity later. The continuity is the product — it's what Facebook groups structurally cannot do, it's what matching operates on, and every Phase 3+ social feature (meet & greets, pet profiles) needs durable pet records.

### The rules that make it work

1. **Case-first UX.** Users never "create a pet profile." They tap *Report lost pet* / *I found a pet* / *List for adoption* and fill one form; the Pet row is created underneath as a side effect. Profiles are enrichment, never a prerequisite.
2. **Responsibility is a link, not a property.** Ownership/custody is a relation between a person/org and a pet, so it can transfer. **An adoption is exactly a responsibility transfer** — the pet record and its history survive the handoff.
3. **Unclaimed pets are normal.** A finder who takes an animal in creates an unclaimed Pet and is marked custodian, not owner. Someone has to hold the photos and traits of that animal — the record exists precisely so the real owner can claim it. A person who only *saw* a stray creates no pet: their report is a sighting, attached to a case when matching can and kept internally as an orphan when it can't.
   Three doors, by **perspective**: Lost is the owner ("I lost *mine*"), Found is the custodian ("I have one that isn't mine"), Sighting is everyone else ("I saw one"). A found case always means custody.
4. **Merge is a first-class, reversible operation.** When a found-report and a lost-report are confirmed to be the same animal, the unclaimed record folds into the claimed Pet and both cases resolve as *reunited*. Wrong merges must be undoable. This is the trickiest flow in the system and the price of the model.
5. **Dormant records cost nothing.** After a case resolves, nobody owes the platform maintenance. Rows just sit there until (if ever) their human enriches them.
6. **"Lost" is never stored on the pet.** It is derived from an active lost case. See [04-lost-workflow.md](04-lost-workflow.md) (lost), [05-found-workflow.md](05-found-workflow.md) (found, sightings, matching contract, merge), [06-adoption-workflow.md](06-adoption-workflow.md) (adoption), and [07-help-workflow.md](07-help-workflow.md) (help), which are the sources of truth for their flows; where this doc and those disagree, they win.
7. **Expiry never changes who is responsible.** A case expiring — lost, found, or adoption — touches neither `responsibility_link` nor `custody_state`; links change only by an explicit transfer (`adopted_in_app`, `kept`, `transferred_to_org`, merge). Expiry means "we lost contact," not "nobody is responsible." **Purge** (expired + 30 days) removes the case, and removes the pet only when it is `unclaimed` with no other case and no other link — a stray nobody vouches for anymore cannot be found by anyone, so there is no one to keep it for. Claimed pets are never purged by a case.
