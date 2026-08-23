# Found Workflow — States & Domain

> The ENCONTRADO vertical. Source of truth for the found flow and for the boundary between lost,
> found, and sightings; where it disagrees with earlier docs, this one wins and the others get
> patched. Shares machinery with [04-lost-workflow_draft_1.md](04-lost-workflow_draft_1.md) —
> `case_checkin`, the claim pattern, location precision — and says so instead of restating it.
> Domain identifiers are English/snake_case; Spanish strings are UI copy.

## The flow, in one pass

```
«Encontré un animal» ──▶ «¿Lo tienes contigo?»
        │
        ├── sí ──▶ match against lost cases ──▶ hit:  recovery_claim on that lost case (no new case)
        │                                  └─▶ miss: found_case (active) ──▶ broadcast
        │                                                 │
        │                                                 ├── "Es mío" → ownership_claim (custodian confirms)
        │                                                 ├── check-ins → reunited | kept | transferred_to_org
        │                                                 └── custodian silent → expired
        │
        └── no ──▶ match against known pets ──▶ hit:  sighting on that pet's lost case
                                            └─▶ miss: orphan sighting (internal, 30 days, keeps matching)
```

## The organizing insight

Three roles, three doors, and the boundary is **perspective, not custody**:

| | **Lost** | **Found** | **Sighting** |
|---|---|---|---|
| Who | The owner: "I lost *mine*" | The custodian: "I have an animal that isn't mine" | Everyone else: "I saw one" |
| Creates | `lost_case` on a claimed pet | `found_case` on an `unclaimed` pet | A `sighting` — on a case if we can match it, orphan if we can't |
| Needs an account | Yes | Yes | No |
| Public card | Yes | Yes | **Never** |

A found case **is** custody. There is no witness variant of it: the neighbor who saw a stray roaming
is a sighting reporter, and the product never shows them a third top-level concept — they tap
«Encontré un animal», answer «¿Lo tienes contigo?», and the branch is ours to handle. This keeps
the home screen at two buttons and keeps non-owners out of the `owner` role by construction.

---

## Entities

### `pet`
Created `unclaimed` in the same transaction as the found case. The custodian fills the same
identification fields as a lost report (species, breed_guess, size, colors[], marks, photos[],
chip_number?) — which is exactly what matching needs.

### `responsibility_link`
The publisher gets `role = custodian`. Only two transitions in this flow touch the link — `kept`
and `transferred_to_org` — and they are the only responsibility transfers in either the lost or the
found flow.

### `found_case`
| Field | Notes |
|---|---|
| `pet_id`, `created_by` | Publisher is registered (account + phone verified) |
| `found_point`, `found_radius_m`, `found_at` | Where and when the animal was encountered. Area + time, same chips as lost. Public render floored at 200 m |
| `holding_where` | `home \| vet \| street_temporary` — one chip, **public**. Tells an owner what urgency to expect |
| `holding_point` | Exact point, **internal, never rendered to anyone**. Safety and ops: a dispute, helping an org locate a pickup. The custodian shares their address in chat if and when they choose |
| `contact_prefs` | `expose_whatsapp`, `expose_email`, `in_app_only` |
| `status`, `resolution`, `resolution_attribution` | State machine below |
| `published_at`, `resolved_at` | No schedule fields — the follow-up schedule lives in `case_checkin` rows, as in lost |

Location precision follows the lost rules exactly: computation on the stored center, rendered circle
floored at 200 m. The floor matters *more* here — the custodian's home is where the animal is
**right now**.

#### Publishing: match first, then create

Before a found case is written, the form runs matching against pets with an active lost case
(§ Matching). A hit is shown as «¿Es este?». Yes → a `recovery_claim` is opened on that lost case
and **no found case is created** — the animal already has an owner looking, and a second card for
it is exactly the duplicate we don't want. Miss → the found case is created: `pet` (`unclaimed`) +
`responsibility_link` (`custodian`) + `found_case`, one transaction.

### `ownership_claim` — «Es mío»
`case_id`, `claimant` (person or anonymous contact), `from_lost_case_id?`,
`proof { older_photos[], chip_number?, vet_card_photo?, note }` — **all optional**,
`status: open | confirmed | dismissed | stale`, `verifying_since?`, `stale_at`.

Mirror of `recovery_claim`, same rules, reversed trust:

- The row is created **before** any contact channel opens. Anonymous: phone required, unverified.
- It adds a «posible dueño» badge and accelerates check-ins. It never changes the case status.
- The custodian answers: confirm («sí, es el dueño»), dismiss, or «aún verificando». Silence →
  `stale` at `stale_at` (claim + 7d, +72h per «verificando»), badge drops, case stays `active`.
- `stale → confirmed` stays possible; the claimant's contact stays attached.

**Proof is offered, never required.** The form says «esto ayuda a quien lo tiene a reconocerte».
A claimant can equally send things in chat. The custodian sees whatever was attached next to the
claim and decides. We are the intermediary: we never adjudicate, and the ToS says so.

Why the asymmetry with lost matters: a fake «lo tengo» costs the owner a wasted trip; a fake «es
mío» costs the **animal**. So the safety copy goes to the custodian, at the badge and on the claim
check-in:

> «Antes de entregarlo, pide una foto anterior del animal, el número de chip o el carnet de
> vacunas. Entrégalo en un lugar público.»

`from_lost_case_id` is set when the claim originates from matching on the lost side («¿Es tu
mascota?» → yes). Confirming such a claim is the trigger for the merge (§ Merge).

### `sighting` — the lost entity, extended
Defined in 04. This flow adds:

- `case_id` is **nullable**. Null = **orphan**: a witness report we could not attach to any case.
- `case_id` may point at a `found_case` as well as a `lost_case` — a found case has a pre-custody
  trail too.
- Orphan-only fields: `species` (required), `size?`, `colors[]?`, `orphan_expires_at`
  (`created_at + 30d`). **Photo is required when orphan** — without a case for context, an
  orphan without a photo is unmatchable and worthless.
- Attaching an orphan sets `case_id`, keeps `seen_at`, clears `orphan_expires_at`. The row doesn't
  move; the trajectory shows it with its original time — the owner gets trail from *before* they
  published.
- At `orphan_expires_at`: matching stops, anonymous contact purged, row kept.

Orphans are **internal**: no card, no broadcast, not public. Their whole value is matching.

### `case_checkin`
Reused as-is from 04, including `deliveries[]`, `cancelled_at`, the derived `next_checkin_at` and
`unanswered_streak`, and "what counts as an interaction". Responses gain the found exits:
`still_holding | reunited | kept | transferred_to_org | delete | claim_confirmed | claim_dismissed |
still_verifying`.

---

## Case state machine

```mermaid
stateDiagram-v2
    [*] --> active: custodian publishes
    active --> active: ownership_claim / checkin "sigo con él"
    active --> reunited: custodian confirms hand-off
    active --> kept: custodian declares «me lo quedo»
    active --> transferred_to_org: custodian declares hand-off to an org
    active --> expired: 2 consecutive check-ins unanswered
    active --> cancelled: custodian deletes
    expired --> active: custodian reopens (≤30 days)
    reunited --> [*]
    kept --> [*]
    transferred_to_org --> [*]
    cancelled --> [*]
    expired --> [*]: purge after 30 days
```

Same shape as lost with five exits instead of three — custody has more ways to end.

### Rule: only the custodian closes a case as reunited
No claimant, no moderator, no timeout sets `reunited`. A confirmed `ownership_claim` is the
custodian's statement that the hand-off happened.

### Rule: `kept` is an assertion with a date, not a legal event
The button is available from day one — we cannot stop anyone from keeping an animal — and the copy
suggests waiting (period pending the lawyer question, [O6](06-open-items.md)). On `kept`: custodian
link closes, a new link `role = owner` opens for the same person, pet `custody_state = claimed`.
The case **stays matchable against new lost cases for 30 days** after `kept`: if the real owner
surfaces, they open an ownership claim like anyone else and the merge path still works.

### Rule: `transferred_to_org` is a declared outcome in v1, not a process
The custodian taps «Lo entregué a una fundación», optionally names it (free text), and the case
resolves. Custodian link closes; pet returns to `unclaimed`; **no org link is created**. The
structured handoff — org accepts → `org` link → `custody_state = org_held` → flows into adoption —
is deferred ([D4](06-open-items.md)). Recording the outcome honestly now costs nothing; building
the process before a foundation asks for it would.

### `resolution` values
`reunited_owner` · `kept_by_finder` · `transferred_to_org` · `found_deceased` · `not_a_stray` ·
`ran_off_again` · `duplicate` · `no_response`

`resolution_attribution: platform_claim | platform_match | platform_share | offline | unknown` —
asked at the reunion moment, same as lost.

---

## The follow-up loop

Same machinery and the same negative framing as lost. A silent custodian is the main way a found
case goes stale, and the animal's situation is then unknown — expiry matters **more** here.

> «Sigues con el perrito que encontraste. Si no nos confirmas, archivaremos el aviso en 5 días.»
> `[ Sigo con él ]  [ Ya está con su dueño 🎉 ]  [ Me lo quedo ]  [ Lo entregué a una fundación ]  [ Eliminar ]`

Claim check-in, to the custodian, with the safety copy:

> «Alguien dice ser el dueño. Si no nos confirmas en 3 días, quitaremos el aviso de posible dueño.»
> «Antes de entregarlo, pide una foto anterior, el chip o el carnet de vacunas. Entrégalo en un
> lugar público.»
> `[ Sí, es el dueño 🎉 ]  [ No es ]  [ Aún verificando ]`

### Schedule
Identical to lost: T+72h then weekly; claim check-ins at +24h/+72h with `stale_at = claim + 7d`,
+72h per «aún verificando»; interaction resets to +7d (check-in answers and explicit actions only;
views don't count); escalation push → WhatsApp → email on the same row; `unanswered_streak = 2` →
`expired`; claim check-ins never count toward the streak.

`expired` is soft: gone from feed and push, reachable by link, reopenable for 30 days. After 30
days the case is purged — and so is the **pet**, if it is still `unclaimed` with no other case and
no other link. A stray whose custodian went silent and whose owner never surfaced within the reopen
window cannot be found by anyone afterwards; keeping it only pollutes the matching pool. The share
link then shows «Este aviso ya no está disponible». Expiry itself changes nothing on the link or
custody ([01, rule 7](01-actors-and-entities.md)); purge is what removes the record.

---

## Matching — the contract this flow needs

The algorithm is its own doc ([O7](06-open-items.md)); this section fixes what it must provide.

```
match(report) → candidates[] of { pet_id, confidence, why[] }
```

`report` = photo + species + point + time + optional traits. `why[]` is human-readable («misma
raza · 400 m · hace 2 días») so the confirmation screen explains itself. It matches **pets, not
cases**: identity first, then the pet's current situation says what the report means.

**Candidates are always confirmed by a human. The contract never auto-attaches.** That is why the
algorithm needs good *recall*, not precision — a missed candidate is quietly kept as an orphan; a
wrong candidate is one tap to dismiss. The failure mode that would hurt is the one we don't build:
auto-creating or auto-merging anything.

### Where it runs

| Trigger | Candidates from | Who confirms | On yes |
|---|---|---|---|
| Witness report («no lo tengo») | Pets with an active lost case nearby | The witness: «¿Es alguno de estos?» | Sighting attached to that pet's lost case |
| Found publish («sí lo tengo») | Pets with an active lost case | The custodian | `recovery_claim` on that lost case, **no found case created** |
| Lost publish | Active found cases + orphans ≤ 30d | The owner: «¿Es tu mascota?» · «Vieron uno parecido ayer a 600 m» | Found → `ownership_claim` with `from_lost_case_id`; orphan → attached with original `seen_at` |
| New orphan arrives | Lost cases published since | The owner, via notification | Attach |

### Outcomes by the matched pet's situation

| Matched pet… | The report means | Action |
|---|---|---|
| has an active **lost** case | A sighting, or a recovery claim if the reporter has it | Attach / open claim — same as reporting from inside the case |
| has an active **found** case | Contradiction: someone claims custody, yet it's seen elsewhere | **Open** ([O5](06-open-items.md)). Until decided: silent, kept as orphan |
| has **no active case** | Wrong match, or the owner hasn't noticed yet | **Open** ([O5](06-open-items.md)). A proactive «¿Luna está contigo?» is powerful and a false alarm is how trust dies. Until decided: silent, kept as orphan |
| no match | An animal we don't know | Orphan. Re-run against lost cases published later |

Both gated nudges unlock on the same measurement: false-match rate below a threshold over N
confirmations, computed from `match.confirmed` / `match.rejected`.

---

## Merge — when lost and found are the same animal

Triggered by a confirmed `ownership_claim` that carries `from_lost_case_id`, or by a confirmed
`recovery_claim` whose claimant has a found case for the same animal (rare: they published before
matching caught it).

1. The `unclaimed` pet folds into the claimed pet: photos, sightings, and the found case re-point.
2. The custodian link closes (`active_to = now`); the owner link continues untouched.
3. **Both** cases resolve: lost → `reunited_home`, found → `reunited_owner`, same
   `resolution_attribution`.
4. `pet.merged` fires; the absorbed pet id stays resolvable as an alias.

**Reversible**: a merge writes a `pet_merge` record (`survivor_id`, `absorbed_id`, `merged_at`,
`merged_by`) and nothing is deleted. Undo re-points everything back and reopens both cases. A wrong
merge otherwise destroys two records at once — this is the trickiest operation in the system and
the price of the pet-centric model.

What remains of the "duplicate" problem after matching-first publish: two custodians for one
animal is impossible (one of them doesn't have it), so a second found case for the same animal is
either a wrong match or a hand-off nobody told us about. Detect on publish, offer, never block.

---

## Identity ladder for this vertical

| Action | Anonymous | Registered |
|---|---|---|
| View, share the card | ✓ | ✓ |
| Witness report («no lo tengo») | ✓ — photo + pin + time + contact (required, unverified) | ✓ — contact from profile |
| «Es mío» | ✓ — phone required → `ownership_claim` → WhatsApp | ✓ — claim → WhatsApp or in-app thread |
| Contact the custodian | ✓ — WhatsApp deep link | ✓ — either |
| Report a publication (abuse) | ✓ — one tap, reason required ([12](12-reporting.md)) | ✓ |
| Earn points / attribution | ✗ | ✓ |
| Publish a found case (custody) | ✗ | ✓ — OAuth + phone verified |

Custody requires an account for the same reason lost publish does, with a stronger version of it:
the custodian must be reachable and accountable for a live animal.

---

## Hooks for the next verticals

- **Adoption**: a custodian who can't keep the stray lists it on the same pet row —
  [08](08-adoption-workflow_draft_1.md) — and `adopted_in_app` transfers the link to the adopter.
  The `org` role and `custody_state = org_held` exist and are unused in v1; the structured
  `transferred_to_org` (D4) is the bridge from a finder to a foundation's listing.
- **Help** (fundraising): a custodian holding an injured stray is the most common reason a
  campaign exists for an `unclaimed` pet. The pet row is the attachment point; nothing else here
  needs to change.

---

## Events

Named only where something consumes them — **N** notification ([05](05-notifications.md)),
**M** metric not derivable from rows, **A** audit. Publishes, resolutions, check-ins, dismissals,
orphan creation: queries over rows.

| Event | Consumer |
|---|---|
| `found_case.broadcast_sent` | N — custodian confirmation; neighborhood push |
| `ownership_claim.opened` | N — custodian, priority |
| `ownership_claim.confirmed` | N — claimant |
| `contact.opened` `{whatsapp_click}` | M — only evidence a WhatsApp contact happened |
| `contact.opened` `{thread_created}` | N — custodian |
| `found_case.expired` | N — custodian, push + email |
| `sighting.attached` | N — the witness; the only feedback an orphan reporter ever gets |
| `match.candidates_shown` | N — the custodian when a lost case matches theirs; N (gated, O5) for the two nudges; M — denominator of the mismatch rate |
| `match.confirmed` · `match.rejected` | M — the mismatch rate that unlocks O5. Not derivable: a rejection leaves no row |
| `pet.merged` · `pet.unmerged` | A — with the `pet_merge` record |
| `responsibility.transferred` | A — on `kept`, `transferred_to_org`, merge |

Notifications for this flow: [`05-notifications.md`](05-notifications.md) → **Found**.

---

## Open items

Tracked in [`06-open-items.md`](06-open-items.md):

- **Open** — O5 matching-driven nudges (owner «¿está contigo?», custodian «¿sigues con él?») ·
  O6 legal: finder keeping a found animal · O7 the matching algorithm
- **Deferred** — D4 structured `transferred_to_org` · D5 «vistos en la zona» orphan map layer
