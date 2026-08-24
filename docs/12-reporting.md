# Reporting — Abuse & Moderation

> Cross-vertical. One table, one set of rules, over every publication in every flow. Adopted from
> the `docs/vertical-workflows` branch (teammate's design) with the events trimmed to the
> consumer rule in [05](05-notifications.md).
> Domain identifiers are English/snake_case; Spanish strings are UI copy.

## The organizing insight

Reporting is the **reactive** half of trust; everything else in the flow docs is preventive (rate
limits, owner-hides-pin, claim confirmation loops, trust tiers). The two halves obey the same
principle from different sides:

> **A report never hides an active case by itself.** The mirror of "a recovery claim must never
> reduce reach": if a stranger could silently suppress a case, a scammer or a spiteful neighbor
> could end a real search. Reports queue for human review; the case keeps broadcasting.

And reporting is for what the affected party *can't* fix themselves. The owner already hides bad
sighting pins — that stays the primary tool. Reports exist for the fake case, the funds scam,
harassment in the contact channel, the publication whose author won't act because they *are* the
problem.

---

## `report`

| Field | Notes |
|---|---|
| `target_type`, `target_id` | Any publication: `lost_case` · `found_case` · `adoption_case` · `help_request` · `sighting` · `recovery_claim` · `ownership_claim` |
| `reporter_person_id?`, `reporter_contact?` | Both optional — reporting is anonymous |
| `reason` | `spam` · `duplicate` · `scam_or_extortion` · `harassment` · `graphic_content` · `personal_data` · `animal_welfare` · `other` |
| `note` | Optional free text |
| `status` | `open` · `actioned` · `dismissed` |
| `reviewed_by`, `reviewed_at`, `resolution_note` | The audit of what an operator did and why |

**Anonymous and one tap.** Requiring an account to report abuse means abuse goes unreported — the
person best placed to flag a scam is usually a stranger who just saw it in the feed. A reason is
required; nothing else is. Rate-limited by device/IP, exactly like sightings.

---

## The rules

1. **A report never hides an active case by itself** (above). No report-count threshold ever
   auto-removes — counts are trivially farmable by one person with opinions and several phones.

2. **Two exceptions auto-hide on the first report, pending review**, because those harms compound
   every hour they stay up: **`graphic_content`** and **`personal_data`** (someone published a home
   address, a full phone number, an ID document). Auto-hidden means hidden from feed and search —
   the direct link shows «en revisión» to the author, nothing to others. Review is fast
   ([O11](06-open-items.md): ≤ 4h) with a one-tap restore when the report was wrong.

3. **`animal_welfare` on a found case is the highest-priority queue** — «this animal is being held
   in bad conditions». It is also the one report type where *contacting the finder* beats hiding
   the post: hiding removes the animal from view without removing it from the balcony.

4. **`scam_or_extortion` on a help request** is the third auto-acting category: it **suspends**
   the request on the first report — loudly, «en revisión», reversible — per
   [09](09-help-workflow.md)'s state machine, because money-collecting fraud converts
   strangers' compassion into income every hour our amplification stays on.

5. **Reporter identity is never shown to the reported party.** Not in the notification, not
   derivable from timing. Outcomes are not reported back to reporters in v1 — closing that loop is
   nice, but each outcome notification is a chance to triangulate who reported.

6. **The platform hides and removes publications; it never adjudicates the underlying dispute.**
   Who owns the animal, whether the fee was fair, whether the campaign was honest — intermediary
   posture, [03](03-legal-colombia.md). We act on the *publication*.

---

## Queue mechanics

- **Grouped by the reported author, not by report.** Repeat targets across cases are the real
  signal; twelve reports on one viral post usually mean the post is visible, not that it's wrong.
- **Reporter weight.** A reporter whose reports are consistently dismissed counts for less —
  silently. Never a visible score.
- **Repeat cold-claimers** (`ownership_claim` opened across multiple found cases with no evidence)
  surface here as a pattern — that is the theft signal, per [07](07-found-workflow.md).
- **Actions available:** dismiss · hide the publication · remove it · contact the author · suspend
  the author (pattern across publications). Every action writes `reviewed_by / resolution_note`.

**Staffing and SLA — [O11](06-open-items.md), set before launch.** Proposed: auto-hidden content
reviewed ≤ 4h, everything else ≤ 48h; operators are the founders. An unstaffed report button is
worse than none, because it promises action nobody takes.

---

## Events

Named per the consumer rule in [05](05-notifications.md); the queue itself is a query over `report`
rows.

| Event | Consumer |
|---|---|
| `report.submitted` | N — operators (immediate for auto-hide reasons and `scam_or_extortion`; batched otherwise) |
| `content.hidden_by_moderation` | N — the publisher, push + email, with reason and a reply channel |

`report.actioned` / `report.dismissed` are row states, not events.
