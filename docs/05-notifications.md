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
| Events exist only for a consumer | An event is named only if something reads it: a notification row here (**N**), a metric that cannot be derived from entity rows (**M**), or the audit trail of responsibility changes (**A**). The doc that defines the event tags its consumer. Anything derivable from rows — cases published per week, resolutions, check-in response rates — is a query over rows, not an event. Vocabulary without a consumer is how event lists rot |
| Implementation | One append-only `events` table (`name`, `subject_id`, `actor_id`, `payload`, `created_at`), written in the same transaction as the thing it describes. Notification jobs and metric queries read it. No bus, no broker |
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

Silent by design, so no event: a claim going stale (the owner ignored two check-ins; the badge just
drops), a claim dismissed, a sighting hidden or corrected (the owner's or reporter's own action).

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

Silent by design, so no event: a claim going stale (badge drops), a claim dismissed — a "no" from a
stranger holding the animal is not something to push.

### To the claimant (registered only)

| Event | Copy | Rule |
|---|---|---|
| `ownership_claim.confirmed` | «¡Confirmaron que es tuyo! Coordina la entrega.» | To the claimant |

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

Events: see `08-adoption-workflow_draft_1.md` → Events. **No broadcast** — listed so nobody adds
one; the push budget belongs to lost/found.

### To the lister

| Event | Channel | Copy | Rule |
|---|---|---|---|
| `adoption_interest.created` | push | «Alguien está interesado en Max.» | Coalesce window: 1 h («3 personas interesadas en Max»). Not priority — nothing here is urgent |
| `contact.opened` (`thread_created`) | push | «Tienes un mensaje sobre Max.» | In-app thread only |
| `adoption_case.expired` | push + email | «Archivamos la publicación de Max. Puedes reactivarla con un toque hasta el 12 de sep.» | Per case, orgs included |

Silent by design, so no event: an interest withdrawn (the list just updates), an interest declined —
a "no" is the lister's to say, in chat, if at all.

### To the adopter (always registered)

| Event | Copy | Rule |
|---|---|---|
| `adoption_interest.chosen` | «Te eligieron para adoptar a Max. Coordina la entrega.» | |
| `adoption_case.adopted` (by someone else) | «Max ya fue adoptado. Gracias por interesarte.» | To everyone with an open interest. Closure, and a nudge back to the feed |

### Check-ins (delivery rule only — cadence lives in 08)

Per case, delivered **per lister**: an individual's listings batch into one push; an org gets one
digest every 30 days covering all its active listings as a checklist. Same coalescing machinery as
everything else, applied to `case_checkin` deliveries.

---

## Help

Events: see `09-help-workflow_draft_1.md` → Events. **No broadcast.**

### To the beneficiary

| Event | Channel | Copy | Rule |
|---|---|---|---|
| `help_contribution.created` | push | «Alguien ayudó en la campaña de Max.» | Coalesce window: 1 h («3 personas ayudaron»). Not priority |
| `help_request.expired` | push + email | «Archivamos la campaña de Max. Puedes reactivarla con un toque hasta el 12 de sep.» | Includes reopen deadline |
| `help_request.suspended` | push + email | «Pusimos la campaña de Max en revisión por un reporte. Responde a este correo para aclararlo.» | Loud, never silent — the card shows «en revisión» while paused |
| `help_request.removed` | push + email | «Retiramos la campaña de Max por reportes. Responde a este correo si crees que es un error.» | Reply channel is the email |

### To contributors

Nothing in v1. A closure message when the request closes («Max se recuperó — gracias») is deferred
([D8](06-open-items.md)). Contributors are **not** told about a removal — their money is already
gone and there is nothing for them to do.

---

## Moderation (cross-journey)

Events: see `12-reporting.md`.

| Event | Target | Channel | Copy | Rule |
|---|---|---|---|---|
| `report.submitted` | operators | ops channel (not user push) | — | Immediate for the two auto-hide reasons and `scam_or_extortion`; batched otherwise. The queue itself is a query over `report` rows |
| `content.hidden_by_moderation` | the publisher | push + email | «Ocultamos tu publicación por [razón]. Responde a este correo si crees que es un error.» | On action, never on report. Reporter identity never included |

Reporters are not notified of outcomes in v1 — closing that loop is nice but each notification is a
chance to triangulate who reported.
