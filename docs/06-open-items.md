# Open Items

> Decisions not yet made (**Open**) and decisions made as "not now" (**Deferred**), across all
> docs. One place, so nothing lives only as a sentence inside a flow doc. Each item links to where
> it bites. When an item closes, write the decision into the owning doc and delete the row here.

## Open — needs a decision

| # | Item | Where it bites | Current thinking |
|---|---|---|---|
| O1 | **Re-broadcast when sightings cluster far from `last_seen_point`.** The first push targets neighbors of the last-seen area; if the animal moves 2 km, the people who could see it now never got one. | [04 · follow-up loop](04-lost-workflow_draft_1.md) · [05 · Lost broadcast](05-notifications.md) | Powerful («Luna se movió hacia el norte»), but it is a second broadcast and the push budget is the scarcest thing we have. Decide together with O2 and the overall notification efficiency rules — not in isolation |
| O2 | **Per-recipient cap on broadcasts per day.** A dense neighborhood on a bad week can turn the core feature into spam. | [05 · Lost broadcast](05-notifications.md) | Needs a number and a policy for what gets dropped when the cap hits (newest? nearest?). Tied to O1 |
| O3 | **«Lo tengo» on an `expired` case.** The card stays reachable by link for 30 days; someone may find the animal during that window. | [04 · state machine](04-lost-workflow_draft_1.md) | Leaning: a claim auto-reopens the case (`expired → active`). A stranger holding the animal is stronger evidence of a live search than the owner tapping «reabrir» |
| O4 | **Stale claims vs. the 30-day purge.** `stale → confirmed` is allowed indefinitely, but the purge deletes anonymous sighter contacts at 30 days — an anonymous stale claim would be orphaned. Applies equally to `ownership_claim`. | [04 · `recovery_claim`](04-lost-workflow_draft_1.md) · [07 · `ownership_claim`](07-found-workflow_draft_1.md) | Either purge anonymous stale claims' contact too (and they become unconfirmable), or exempt claims from the purge. Decide with the legal retention rules in [03](03-legal-colombia.md) |
| O5 | **Matching-driven nudges.** When a report matches a pet with *no active case*: proactively ask the owner «¿está contigo?». When it matches a pet with an *active found case*: ask the custodian «¿sigues con él?». Both are valuable if matches are reliable and spam if they aren't. | [07 · matching outcomes](07-found-workflow_draft_1.md) · [05 · Found gated](05-notifications.md) | **Silent until measured.** Unlock when the false-match rate (from `match.confirmed` / `match.rejected`) is below a threshold over N confirmations. Threshold and N to set once there is data |
| O6 | **Legal: a finder keeping a found animal.** `kept` is an assertion with a date; Civil Code rules on found movable property may apply to animals, and we may want to *recommend* a minimum holding period before the button. | [07 · `kept` rule](07-found-workflow_draft_1.md) · [03](03-legal-colombia.md) | For the one lawyer review already budgeted. Nothing in 03 covers finders today |
| O7 | **The matching algorithm.** Must satisfy the contract in 07 (pet-centric, candidates with human-readable reasons, recall over precision, never auto-attach). v2 adds photo embeddings as one more score. | [07 · matching contract](07-found-workflow_draft_1.md) · [02 §4](02-flows.md) | Own doc. Blocks nothing in v1 except how good the candidate list is |

## Deferred — decided "not now"

| # | Item | Where it bites | Reopen when |
|---|---|---|---|
| D1 | **Multiple `owner` links per pet** (households). One active owner link per pet today; a partner who registers later can't answer check-ins or confirm a reunion. | [04 · `responsibility_link`](04-lost-workflow_draft_1.md) | A second household member asks to act on a case, or the adoption vertical needs co-owners |
| D2 | **`paused` case status** — owner mutes the search without closing it. | [04 · rejected states](04-lost-workflow_draft_1.md) | An owner asks for it. No evidence yet anyone wants to pause mid-search |
| D3 | **Sighting relevance beyond recency** — weighting by photo, registered reporter, or cluster corroboration. | [04 · display rules](04-lost-workflow_draft_1.md) | Enough sightings per case to tune a ranking against real reunions. Recency + owner highlight until then |
| D4 | **Structured `transferred_to_org`** — org accepts the handoff → `org` responsibility link → `custody_state = org_held` → flows into an adoptable listing. v1 records the outcome as a declaration with no org link. | [07 · `transferred_to_org` rule](07-found-workflow_draft_1.md) | An onboarded foundation receives animals from finders and wants them in its inbox |
| D5 | **«Vistos en la zona» map layer** — showing orphan sightings publicly. Today orphans are internal and only feed matching. | [07 · `sighting`](07-found-workflow_draft_1.md) | Enough orphans per zone that the layer would show something, and a privacy review of exposing witness pins |
