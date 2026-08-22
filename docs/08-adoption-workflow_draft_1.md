# Adoption Workflow — States & Domain

> The ADOPCIÓN vertical. Source of truth for the adoption flow; where it disagrees with earlier
> docs, this one wins and the others get patched. Reuses the machinery in
> [04](04-lost-workflow_draft_1.md) and [07](07-found-workflow_draft_1.md) — `case_checkin`, the
> row-before-channel rule, location precision — and says so instead of restating it.
> Domain identifiers are English/snake_case; Spanish strings are UI copy.

## The flow, in one pass

```
lister ──publishes──▶ adoption_case (active) ──▶ feed (by proximity) · shareable card
  person or org                  │
                                 ├── «Me interesa» → adoption_interest (intro + channel)
                                 │         lister: list of interests → chosen → adopted
                                 │
                                 └── check-ins ──▶ lister answers ──▶ adopted | withdrawn
                                                  lister silent  ──▶ expired
```

## The organizing insight

**v1 adoption is a listing vertical, not a screening vertical.** The people we serve first are
individuals — an owner rehoming, a rescuer, the custodian from the found flow who can't keep the
stray — and they screen adopters in chat, as they do today on Instagram. Foundations with their own
process get a listing that links out to it. The ranked, filterable application inbox from the
original sketch is deferred until a foundation has moved its process to us and asks for it.

What we add over an Instagram post: a listing with reach and continuity (a found stray becomes an
adoptable listing on the *same* pet row), an interest row before every conversation so the lister
sees who is interested without reading forty chats, and a recorded outcome that transfers
responsibility to a real person.

---

## Entities

### `pet`
Already exists — the lister holds it. `custody_state` is whatever it was: `claimed` (owner
rehoming), `unclaimed` (custodian with a stray), `org_held` (org). Listing changes nothing on the
pet; only the outcome does.

### `responsibility_link`
The lister's link is whatever it already is — owner, custodian, or org. **Listing does not touch
it.** `adopted_in_app` is the canonical responsibility transfer: lister's link closes, a new
`role = owner` link opens for the adopter, pet becomes `claimed`, history rides along.

### Organization — what this flow needs from it
It exists, it's verified (personería jurídica reviewed — the trust tier), it can set a **business
WhatsApp number** on its profile that overrides the account phone for all its listings, and its
listings carry the `verified` badge. Nothing else. Inboxes, members, roles: not v1.

### `adoption_case`
| Field | Notes |
|---|---|
| `pet_id`, `created_by` | Lister is registered (person or org) and holds the pet |
| `story` | Free text — the post |
| `temperament[]` | Chips: `good_with_kids`, `good_with_cats`, `good_with_dogs`, `needs_yard`, `special_care`, `senior`, `puppy` |
| `requirements` | Free text — what the lister asks of an adopter |
| `location_point`, `location_radius_m` | Where the animal is. Area, not pin; public render floored at 200 m — the lost/found rule |
| `contact_prefs` | `expose_whatsapp`, `expose_email`, `in_app_only` |
| `external_url?` | An org's own application page. Independent of WhatsApp — a lister can have both |
| `trust_tier` | Derived from the lister: `verified` (org with reviewed document) · `individual` (identity only). Rendered as a badge with honest copy: «Publicado por una persona — la verificación es entre ustedes» |
| `status`, `resolution`, `published_at`, `resolved_at` | State machine below. No schedule fields — `case_checkin` rows |

### `adoption_interest` — «Me interesa»
`case_id`, `person_id` (**always registered**),
`intro { housing: casa | apartamento, has_yard: bool, other_pets: text?, household: text?, why: text }`,
`status: open | chosen | declined | withdrawn`, `created_at`.

**One screen, before the channel opens.** Four fields and a free-text «¿por qué este?». Submitting
creates the row, then opens the channel — same row-before-channel rule as every other contact
action, for the same reasons: count, attribution, and the lister's list.

**One interest per person per case.** Tapping again reopens the existing conversation. Withdrawal is
one tap («ya no me interesa»), which is what keeps the lister's list honest.

#### Channel, after the row
| Lister has enabled | What happens |
|---|---|
| One channel only | Redirect straight there — `wa.me` with the intro prefilled, the `external_url`, or the in-app thread with the intro as its first message. No extra tap |
| WhatsApp **and** `external_url` | One sheet: `[ Escribir por WhatsApp ]  [ Aplicar en su sitio ]` |
| In-app only | Thread opens |

For an `external_url` nothing can be prefilled; the interest row is the only record we keep — which
is exactly why the row exists.

Copy shown at the moment the channel opens, both sides: **pending**. The slot is here; the words
come later.

### What the lister sees
Not an inbox. A **list** on their listing: name, city, the four intro fields as chips, when they
applied, and the conversation link. No ranking, no scoring. Three actions:

- **Mark as chosen** → `interest.status = chosen`; the listing shows «en proceso» publicly, stays
  visible, still accepts interest — deals fall through.
- **Decline** → optional, silent to the adopter. If the lister wants to say no, they say it in chat.
- **Record adoption** → «¿Quién lo adoptó?» picks from the list (→ `adopted_in_app`, link
  transfer) or «fuera de la app» (→ `adopted_offline`).

Anything heavier — configurable screening questions, shortlists, stages — is the deferred inbox
([D6](06-open-items.md)).

### `case_checkin`
Reused from 04. Responses: `still_available | adopted | no_longer_available`. **Check-ins are per
case; delivery is per lister; cadence by lister type** (below).

---

## Case state machine

```mermaid
stateDiagram-v2
    [*] --> active: lister publishes
    active --> active: interest / chosen / checkin "sigue disponible"
    active --> adopted: lister records the outcome
    active --> withdrawn: lister takes it down
    active --> expired: 2 consecutive check-ins unanswered
    expired --> active: lister reopens (≤30 days)
    adopted --> [*]
    withdrawn --> [*]
    expired --> [*]: purge after 30 days
```

No `cancelled` separate from `withdrawn`: on adoption there is no "false alarm," only "no longer
available," and one exit with a reason covers it.

### `resolution` values
`adopted_in_app` · `adopted_offline` · `kept` · `deceased` · `transferred` · `no_response`

### Rule: `adopted` is a responsibility transfer, recorded honestly
- **`adopted_in_app`** — the adopter is a registered person picked from the interest list. Lister's
  link closes (`active_to = now`), new link `role = owner` for the adopter, pet
  `custody_state = claimed`. The pet's history (found as a stray, listed, adopted) travels with it.
  Fires `responsibility.transferred`.
- **`adopted_offline`** — the adopter isn't on the platform (an org's own process, a friend). Lister's
  link closes; **no new link**; pet `claimed` with no owner link. Recorded as what it is rather than
  faked with a placeholder person.

### Rule: expiry never changes who is responsible
Cross-vertical, stated in [01](01-actors-and-entities.md): a case expiring touches neither
`responsibility_link` nor `custody_state`. The lister's link stays whatever it was. Purge (expired +
30 days) removes the case; it removes the **pet** only if the pet is `unclaimed` with no other case
and no other link — i.e., a found-flow stray nobody vouches for anymore.

---

## The follow-up loop

Stale listings are the plague of every adoption board, so: same negative framing, same machinery.

> «Max sigue publicado en adopción. Si no nos confirmas, archivaremos la publicación en 5 días.»
> `[ Sigue disponible ]  [ Ya fue adoptado 🎉 ]  [ Ya no está disponible ]`

«Ya fue adoptado» leads to «¿quién?» → pick from interests, or «fuera de la app».

### Cadence by lister type

| Lister | Cadence | Delivery |
|---|---|---|
| Individual | T+7d, then every 14d | Per case; several listings batch into one push |
| Org | Every 30d | **One digest per org** covering all active listings as a checklist: «Tienes 12 animales publicados en adopción. Marca los que ya no están disponibles.» Untouched entries count as «sigue disponible» |

Slower than lost/found because nothing is urgent — but never silent: orgs are *where* stale listings
come from (forty animals, three adopted last month, nobody took them down). Changing the unit to
"one question per lister" removes the spam without removing the question.

Expiry per listing: `unanswered_streak = 2` — ~28 days of silence for an individual, ~60 for an org.
When an org's whole batch expires at once, that's the right signal: the org has left.

Escalation push → WhatsApp → email on the same row, interaction resets (check-in answers and
explicit actions — marking chosen, recording adoption — not views), `expired` soft and reopenable
for 30 days: all as in 04.

---

## Reach

**Feed** by proximity to `location_point`, national fallback when the local feed is empty, plus the
**shareable card** (photo, EN ADOPCIÓN, zone, link back). **No geo push** — an adoption listing is
not an emergency, and the push budget belongs to lost/found ([O1/O2](06-open-items.md)). A weekly
opt-in digest is deferred ([D7](06-open-items.md)).

---

## Identity ladder for this vertical

| Action | Anonymous | Registered |
|---|---|---|
| View, share the card | ✓ | ✓ |
| «Me interesa» | ✗ | ✓ — OAuth + phone verified, short intro |
| Contact the lister | ✗ — only through an interest | ✓ — WhatsApp, external URL, or thread |
| Publish a listing | ✗ | ✓ — person or org that holds the pet |
| Earn points / attribution | ✗ | ✓ |

The only vertical where nothing beyond viewing is anonymous: adopting is a commitment, not a tip,
and the hand-off needs two real identities for the link transfer.

---

## Events

Named only where something consumes them — **N** notification ([05](05-notifications.md)),
**M** metric not derivable from rows, **A** audit. Publishes, withdrawals, declines, check-ins,
resolutions: queries over rows.

| Event | Consumer |
|---|---|
| `adoption_interest.created` | N — lister, coalesced |
| `adoption_interest.chosen` | N — the adopter |
| `contact.opened` `{whatsapp_click \| external_click}` | M — only evidence the contact happened; for `external_url` it is the *only* record after the interest row |
| `contact.opened` `{thread_created}` | N — lister |
| `adoption_case.adopted` | N — everyone else with an open interest |
| `adoption_case.expired` | N — lister, push + email |
| `responsibility.transferred` | A — on `adopted_in_app`; shared with `kept`, `transferred_to_org`, merge. Every change of who is responsible, one event to audit |

Notifications: [`05-notifications.md`](05-notifications.md) → **Adoption**.

---

## Open items

Tracked in [`06-open-items.md`](06-open-items.md):

- **Open** — O8 points: which events earn them, weights, what status displays
- **Deferred** — D6 structured adoption inbox · D7 adoption digest push
