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
| Hosting — staging (EC2 `t4g.small` + EBS + public IPv4) | ~$18 | 2026-10-23 (approx) | Postgres in Docker on the same instance ([infra.md](infra.md)). Covered by the new account's credits for the first months |
| Hosting — production adds RDS `db.t4g.micro` + 20 GB | ~$15 | 2026-10-23 (approx) | From the launch phase on ([infra.md](infra.md) · Environments) |
| New Relic (traces, metrics, logs) | $0 inside 100 GB/month free; beyond that per-GB pricing | 2026-10-29 (approx; not re-verified) | Decision #38; volume guards in [backend.md](backend.md) · Observability. Re-verify the per-GB price before ingest nears the free limit |
| CloudWatch Logs (backend crash record) | $0 inside 5 GB/month | 2026-10-29 (approx) | WARN-and-up only, megabytes at launch ([infra.md](infra.md) · Logs) |
| Route 53 hosted zone | $0.50 | 2026-10-23 | |
| SQS | $0 | 2026-10-23 | 1M requests/month free permanently; every call counts, including empty long polls |
| Media: S3 + CloudFront + Lambda transforms | ~$0 at launch | 2026-10-23 (approx) | Inside the free tiers at launch volume; decision #32, [infra.md](infra.md) · Media |
| Web Push, Google OAuth, `wa.me`/`mailto:` | $0 | — | Free by construction |

## Variable / per-event

| Item | Unit cost | Verified | Driver |
|---|---|---|---|
| Publisher OTP (SMS to CO) | **$0.0592/send**, ~1–2 sends | 2026-08-23 | Once per publisher, ever. 1,000 publishers ≈ $60–90 cumulative, not monthly |
| Email beyond free tier | ~$0.0004 | 2026-08-27 | ~4–5k/mo at 1,000 active cases (model in [comms.md](comms.md)) |
| Conversations media | $0.25/GB/mo | 2026-08-23 | Purge rules stop the meter |
| WhatsApp templates (post-WABA, D15) | ~$0.005–0.01/msg | 2026-08-23 (approx) | Replaces $0.0592 SMS economics where it applies |

## Snapshot scenarios

| Scale | Est. monthly, excluding AWS hosting (~$18 staging, ~$33 with production RDS — rows above) |
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
- **AWS Free Plan** ([infra.md](infra.md) · Account): move to the Paid Plan before month 6, or the
  account closes. AWS Budgets alarm on monthly spend from day one.
- **New Relic ingest at 50 / 80 GB in a month** → the usage alert emails
  (`infra/terraform/observability`); lower trace sampling first.
- **SQS above ~1M requests/month** → starts billing; check long-poll settings before anything else.
