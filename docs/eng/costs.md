# Costs — What Running Scuby Costs per Month

> The one place monthly spend is tracked. Every price carries its verification date; re-verify
> before relying on one that's aged. Update this doc whenever a price, assumption, or trigger
> changes — it answers "what does the app cost us this month."

## Fixed monthly

| Item | Cost (USD/mo) | Verified | Notes |
|---|---|---|---|
| Twilio international long code (OTP sender) | ~$1–3 | 2026-08-23 (approx; pricing page moved) | One number, sender for publisher OTPs; carriers rewrite to a short code in CO |
| Domain + DNS | ~$1–2 | — | Amortized yearly registration |
| Transactional email | $0 → **$20** | 2026-08-27 | Free tier (Resend-class, 100/day) until **~300 active cases**, then the ~$20 tier (50k/mo) |
| Twilio Conversations | $0 → usage | 2026-08-23 | First **200 active chat users/mo free**, then $0.05/MAU. Fallback channel — expected $0 for a long time (cost rules in [comms.md](comms.md)) |
| Hosting (app + Postgres + jobs) | **TBD** | — | Decided with the backend/infra pass |
| Media storage + CDN + transforms | **TBD** | — | O10 (build vs. service); content-hashed masters, on-demand variants |
| Web Push, Google OAuth, `wa.me`/`mailto:` | $0 | — | Free by construction |

## Variable / per-event

| Item | Unit cost | Verified | Driver |
|---|---|---|---|
| Publisher OTP (SMS to CO) | **$0.0592/send**, ~1–2 sends | 2026-08-23 | Once per publisher, ever. 1,000 publishers ≈ $60–90 cumulative, not monthly |
| Email beyond free tier | ~$0.0004 | 2026-08-27 | ~4–5k/mo at 1,000 active cases (model in [comms.md](comms.md)) |
| Conversations media | $0.25/GB/mo | 2026-08-23 | Purge rules stop the meter |
| WhatsApp templates (post-WABA, D15) | ~$0.005–0.01/msg | 2026-08-23 (approx) | Replaces $0.0592 SMS economics where it applies |

## Snapshot scenarios

| Scale | Est. monthly (excl. hosting/media TBD) |
|---|---|
| Launch (≤300 active cases) | **~$3–5** — number rental + domain; everything else in free tiers |
| 1,000 active cases | **~$25–30** — email tier + number + trickle of OTPs |
| 10,000 users / few k cases | **~$50–100** — email volume, Conversations past free tier, OTP flow; hosting becomes the dominant line |

## Spend triggers & alarms

- **~300 active cases** → email paid tier (~$20/mo).
- **>200 monthly chat users** → Conversations starts billing; check the receive-only inference on
  the first invoice ([comms.md](comms.md) rule 6).
- **Daily SMS spend alarm** ([auth.md](auth.md)): sends × $0.06 above a few dollars/day = pumping.
- **First Twilio invoice**: verify Conversations MAU count matches the lazy-creation rules.
- Hosting + media rows get real numbers when O10 and the backend doc land.
