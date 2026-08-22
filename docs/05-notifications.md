# Notifications

> Every message the platform sends that does **not** expect an answer, across all journeys.
> Check-ins (questions the owner must answer) are not here — they live with the flow that owns
> them, as `case_checkin` rows. This doc is the contract for everything else.
> Copy is illustrative Spanish UI text; the **Rule** column is what engineering implements.

## Global rules

Apply to every journey unless a row says otherwise.

| Rule | Contract |
|---|---|
| Trigger | Every notification is fired by a named domain event. No event, no message. Adding a notification means adding an event first |
| Default channel | Push. In-app inbox always receives a copy |
| No push permission | The flow's single highest-priority message (e.g. a recovery claim) falls back to a WhatsApp template. Everything else stays in-app |
| Quiet hours | 22:00–07:00 local. Non-priority pushes are held and delivered at 07:00, coalesced into one. Priority rows are marked and go through |
| Coalescing | Same event, same target, same case, within the row's window → one push with a count («3 avistamientos nuevos»). Never coalesce across cases |
| Anonymous targets | We own no channel to them. Rows targeting helpers are registered-only |
| Idempotency | One notification per (event id, target). Retries never double-send |
| Unsubscribe | Per-journey toggle in settings; priority rows cannot be muted while the user has an active case |

---

## Lost

Events: see `04-lost-workflow_draft_1.md` → Events.

### To the owner

| Event | Channel | Copy | Rule |
|---|---|---|---|
| `lost_case.broadcast_sent` | push | «Tu aviso de Luna ya llegó a los vecinos de la zona.» | Once per case. Confirms the publish did something |
| `sighting.reported` | push | «Alguien vio a Luna hace 2 h a 400 m de donde se perdió.» | Time is `seen_at` relative, distance from `last_seen_point`. Late report («…dice que la vio ayer 18:30…») is worded as such, never as "now". Coalesce window: 10 min |
| `recovery_claim.opened` | push → WhatsApp if undelivered in 15 min | «Alguien dice que tiene a Luna. Ábrelo para contactar.» | **Priority.** Never coalesced, ignores quiet hours |
| `contact.opened` (`thread_created`) | push | «Tienes un mensaje sobre Luna.» | In-app thread only. A `whatsapp_click` sends nothing — the WhatsApp message itself is the notification |
| `lost_case.expired` | push + email | «Archivamos el aviso de Luna. Puedes reactivarlo con un toque hasta el 12 de sep.» | Email because the owner has, by definition, ignored push. Includes the reopen deadline |
| `recovery_claim.stale` | — | — | Silent. The owner ignored two claim check-ins on it; a third message is noise. The badge just drops |
| `sighting.hidden` · `sighting.highlighted` · `sighting.corrected` | — | — | Silent to the owner (their own action, or a reporter fixing a pin) |

### To helpers (registered only)

| Event | Copy | Rule |
|---|---|---|
| `sighting.highlighted` | «El dueño de Luna marcó tu avistamiento como útil.» | To the reporter. Feeds points; the feedback loop that makes people report twice |
| `recovery_claim.confirmed` | «¡El dueño confirmó que era Luna! Gracias por traerla de vuelta.» | To the claimant |
| `lost_case.reunited` | «¡Luna volvió a casa! 🎉» | To every registered person with a visible sighting or claim on the case. Closure is the reward |

### Broadcast (to the neighborhood)

The initial `lost_case.broadcast_sent` push to nearby users is the reach mechanism of the flow, not
a notification in the sense above — it targets people with no relationship to the case. Its radius,
audience, and frequency caps are defined in the lost flow doc; listed here only so the channel
budget accounts for it.

| Event | Channel | Copy | Rule |
|---|---|---|---|
| `lost_case.broadcast_sent` | push | «Se perdió Luna cerca de ti. ¿La has visto?» | One per case per recipient. Per-recipient daily cap: **open, [O2](06-open-items.md)**. Second broadcast when sightings move: **open, [O1](06-open-items.md)** |

---

## Found

Events: see `07-found-workflow_draft_1.md` → Events.

### To the custodian

| Event | Channel | Copy | Rule |
|---|---|---|---|
| `found_case.broadcast_sent` | push | «Tu aviso ya llegó a los vecinos de la zona.» | Once per case |
| `ownership_claim.opened` | push → WhatsApp if undelivered in 15 min | «Alguien dice ser el dueño. Ábrelo para ver lo que envió.» | **Priority.** Never coalesced, ignores quiet hours. Carries the hand-off safety copy in the detail view |
| `match.candidates_shown` (a new lost case matched this found case) | push | «Publicaron un aviso de perdido que se parece al animal que tienes.» | Coalesce window: 1 h. Not priority |
| `contact.opened` (`thread_created`) | push | «Tienes un mensaje sobre el animal que encontraste.» | In-app thread only; WhatsApp clicks send nothing |
| `found_case.expired` | push + email | «Archivamos tu aviso. Puedes reactivarlo con un toque hasta el 12 de sep.» | Email because push was ignored. Includes reopen deadline |
| `ownership_claim.stale` | — | — | Silent; badge drops |

### To the claimant (registered only)

| Event | Copy | Rule |
|---|---|---|
| `ownership_claim.confirmed` | «¡Confirmaron que es tuyo! Coordina la entrega.» | To the claimant |
| `ownership_claim.dismissed` | — | Silent. A "no" from a stranger holding the animal is not something to push |

### To a witness (registered only)

| Event | Copy | Rule |
|---|---|---|
| `sighting.attached` | «Tu reporte ayudó: lo vincularon al aviso de Luna.» | The only feedback an orphan reporter ever gets, and the reason they report again |

### Broadcast (to the neighborhood)

| Event | Channel | Copy | Rule |
|---|---|---|---|
| `found_case.broadcast_sent` | push | «Encontraron un perro cerca de ti — ¿es tuyo?» | Same caps as lost: [O1](06-open-items.md), [O2](06-open-items.md) |

### Gated (not sent until O5 is decided)

| Event | Target | Copy | Gate |
|---|---|---|---|
| `match.candidates_shown` where the matched pet has **no active case** | the pet's owner | «¿Luna está contigo? Alguien reportó un animal parecido cerca.» | [O5](06-open-items.md) — mismatch rate below threshold |
| `match.candidates_shown` where the matched pet has an **active found case** | the custodian | «¿Sigues con el animal que encontraste? Lo reportaron en otro lugar.» | [O5](06-open-items.md) |

## Adoption

_Pending._
