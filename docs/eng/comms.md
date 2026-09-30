# Comms — Channels, Transport, Ladders

> Decided 2026-08-27. [product/08-notifications.md](../product/08-notifications.md) owns *behavior*
> (what gets sent, copy, rules); this doc owns *transport* — which channel, which provider, what it
> costs, and how the pieces integrate. Prices live in [costs.md](costs.md).

## The stack

| Channel | Provider | Role |
|---|---|---|
| Person-to-person contact | `wa.me` / `mailto:` deep links | **Primary.** Free, zero build; the user's own apps do the talking |
| In-app fallback conversations | **Twilio Conversations** | The number-free channel (below). Fallback behind WhatsApp, never the default CTA |
| Push | Web Push (VAPID), self-served | Free. FCM/APNs arrive with the Capacitor shell ([frontend.md](frontend.md)); `push_subscription.kind` already expects them |
| Transactional email | **Resend-class** (Resend / SendGrid free tier) → SES | Codes, escalations, notices. Switch trigger in costs.md |
| SMS | Raw Twilio | **Exactly one use in the product: publisher OTP** ([auth.md](auth.md)). Nothing recurring |
| WhatsApp business-initiated | Deferred — WABA pilot ([D15](../open-items.md)) | Restores the richer ladder when it lands |

**Orchestration is always ours.** The escalation ladder, quiet hours, coalescing, and `deliveries[]`
live in our backend, reading the events table. Providers are dumb pipes — none of them ever decides
*when or why* a message sends, only *how*. Switching any provider is an adapter change.

---

## The launch ladder (no WABA)

| Path | Ladder |
|---|---|
| Check-in escalation | **push → email (+24h)**. "Unanswered" = both delivered, no response |
| Claim opened (`recovery_claim` / `ownership_claim`) | **Push only.** In the common path the claimant *is* the notification — their WhatsApp message reaches the owner directly. Every edge (handoff never sent, `in_app_only` owner, no push) is caught by the **+24h claim check-in** (push → email). A claimant *has* the animal, safe; hours cost little |
| No push permission / iOS not installed | In-app + email. No special channel |
| WABA lands (D15) | WhatsApp template returns as the escalation middle step (push → WhatsApp → email) and as a near-free minutes-level claim fallback |

`case_checkin.deliveries[].channel`: `push | email | whatsapp` — `whatsapp` present but unused at
launch (a seam, like adoption's `lane`). SMS is deliberately **not** in the enum.

---

## Actionable check-ins — one row, three surfaces

Every check-in's buttons («Sigue perdida» · «Ya apareció» · «Eliminar») answer the same
`case_checkin` row; answered anywhere = answered everywhere, and the ladder stops.

| Surface | Mechanics |
|---|---|
| Push, Android | Web Push **notification action buttons** (service worker `showNotification` + `actions`); a tap answers via the SW without opening the app |
| Push, iOS / no action support | Notification tap deep-links to the check-in screen — the case page with the buttons as a banner |
| In-app | A pending check-in renders as a banner on the case and home until answered (`responded_via: in_app`) — the user who ignores every notification still meets the question on next open |
| **Email** | **Signed one-tap links**: each button is `scuby.co/r/<token>`, single-use, expiring, bound to `(checkin_id, response)`. **No login needed — the token is the auth** (the email reader rarely has a session) |

### The scanner rule (email)

Mail scanners prefetch links — Gmail/Outlook "click" everything, and a naive GET-that-acts would
mark cases «ya apareció» by robot. So:

- **Safe response** (keeps state: «sigue perdida», «sigo con él», «sigue disponible», «sigue
  activa») — may act on the GET, landing on «Gracias, seguimos buscando».
- **Consequential response** («ya apareció», «eliminar», «sí, es el dueño», «ya fue adoptado»,
  «ya no necesita ayuda») — the link lands on a one-button confirm page; the action is the POST
  behind that tap. One extra tap, scanner-proof.

---

## Email: provider and volume model

**Resend-class now** (free tier, minutes to set up, dashboards, managed suppression lists), **SES
when volume makes $/1k matter**. One adapter; the switch is config. Domain SPF/DKIM from day one
([auth.md](auth.md)) or codes land in spam.

Volume at **1,000 active cases** (mix-weighted check-in cadences, 60–70% escalating to email):
**~4–5k emails/month** — escalations ~2.5–3.5k, notices ~300, login codes are the small term
(email-door users ≈ 1 code/month each). The binding constraint is the free tiers' **100/day cap**,
not the monthly cap: check-ins are a daily cron, and ~300 active cases ≈ 100 sends/day.

> **Upgrade trigger: ~300 active cases → the ~$20/mo tier.** Tracked in [costs.md](costs.md).

---

## Twilio Conversations — the fallback chat contract

Two registered users per case; our UI on their client SDK; Rails mints access tokens; message
webhooks feed moderation ([product/09](../product/09-reporting.md)) and our own push. Verified
pricing: **first 200 active users/month free**, then $0.05/MAU (an identity counts once per month
across all conversations); no per-message chat fees; media $0.25/GB/mo.

**Cost rules (verified 2026-08-23, agent-researched; sources in the research report):**

1. **Create the Conversation lazily on first message, never on intent** — creating it with both
   participants bills both users that month even if nobody chats. WhatsApp deep links are primary;
   most cases must never touch Twilio.
2. **Connect the client SDK only when the chat screen opens** — connecting is a billable
   activation. Never at app launch.
3. **Never sync profile data to Twilio User records** — every REST update to a User is an
   activation. Names and avatars stay in our DB.
4. **On case resolution: `state=closed`, don't remove participants** — removal is a billable user
   event; closing isn't. Closed is read-only and final. Service default `timers.closed ≈ P30D`
   auto-closes stale chats and keeps identities under the 1,000-conversation cap.
5. **Purge = `DELETE` the Conversation** — hard-deletes messages, participants, and media
   permanently (Ley 1581 compliance; stops the media meter). `DELETE User` when purging a person.
   Conversations are exempt from Twilio's 13-month auto-retention — **our purge rules are the only
   retention**.
6. **Gotchas:** one message on the 31st = a full MAU-month; migration scripts that touch Users
   activate everyone; "receive-only users aren't re-billed" is an inference from Twilio's
   enumerated activation events — **verify on the first invoice**.

**One conversation per case-pair; one channel per pair**: if the WhatsApp deep link was used, no
thread is spawned — the card shows one contact affordance at a time. Twilio joins the named data
processors in the privacy policy.

**Future**: with the WABA, a Conversation can hold a WhatsApp participant — one side in-app, the
other in their WhatsApp via our business number, **neither exposing a number** (the proxy pattern;
the only real path to finder-anonymity-until-trust). D15.
