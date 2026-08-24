# Auth — Identity, Sign-in, Phone Verification

> Decided 2026-08-23. The UI contract below is what screens implement — the design pass for any
> publish flow reads this doc plus the vertical's Publishing section.

## Sign-in: two doors, no passwords

> `[ Continuar con Google ]`
> `[ Continuar con mi correo ]`

- **Google** — one-tap; on Android the account is on-device, no password recall.
- **Email** — 6-digit code (not a magic link: links open the wrong browser and orphan the PWA
  session). Transactional email (SES/Resend-class, ~$0.10/1000); domain with SPF/DKIM from day one
  or codes land in spam.
- **No password column exists.** Passwordless is not a shortcut — password auth still requires the
  same email infrastructure (resets), plus hashing, breach liability, and permanent support load.
- Accounts are born **lazily** at the first gated action (publish, «es mío», «me interesa»,
  «ya ayudé»). There is never a standalone signup screen.
- Apple gotcha for later: it returns the user's name **only on first authorization** — capture it
  then or lose it. (Apple login itself is deferred — see Deferred.)
- Sessions are long-lived (refresh ~12 months, device-bound).

## Profile

`display_name` (prefilled from OAuth, editable) · `photo?` · `email` (login identity, not editable
in v1) · `phone?` (below) · `city?` · `bio?` (~280 chars, plain text, **no links** — a bio with a
WhatsApp link bypasses contact prefs; it is a `report` target like any user content) · contact
prefs · notification toggles. Nothing else — no address, ID, birthday, gender (Ley 1581 rewards
minimization; nothing needs them).

## Phone: not a login — reachability, verified once

**Who has one:**

| Who | Phone? |
|---|---|
| Publishers (any vertical) | **Required, OTP-verified**, at first publish |
| Anonymous «lo tengo» claimant | Collected, **unverified** — the owner's callback channel |
| Everyone else (interest, contributions, sightings, threads) | Never asked |

Helpers contacting a poster need no number of their own on file: the `wa.me` deep link opens
*their* WhatsApp toward the poster's exposed number.

**Unverified numbers are trusted enough to act on.** They are format-validated at input
(libphonenumber, country pattern, stored E.164), so the owner-side UI renders a claimant's
collected number as buttons — `[ Abrir WhatsApp ]` (`wa.me`) · `[ Llamar ]` (`tel:`) — never as
inert text to retype. The failure mode of a fake number is one unanswered chat and a dismissed
claim. One caveat for owners who chose `in_app_only`: outreach from their personal phone reveals
their own number, so the claim card says «Al escribirle, esa persona verá tu número» before the
buttons. When the WABA exists, existence validation replaces the checkbox.

### UI contract — the phone step in every publish flow

| Moment | Screen behavior |
|---|---|
| First publish, no verified phone | Inline field in the publish form, framed by purpose: «Los vecinos te contactarán a este número». Country selector **pre-filled from `supported_countries`** (+57 in v1) — the user types only their number; stored E.164. OTP entry inline; the case does not go live unverified |
| Every later publish | The verified number is **shown, prefilled**, with «cambiar» beside it — the publisher must see which number the card is about to expose |
| Change (at publish or in settings) | New number → new OTP. **Verification belongs to the number, not the person**; it never carries over |
| WhatsApp | «Este número tiene WhatsApp» is asserted by a checkbox, not verified (no WABA yet — existence checks and WhatsApp OTP both arrive with the WABA pilot, D15). Self-healing: a wrong assertion is a dead chat, and the number is editable |

### OTP mechanics (DIY over raw SMS — no Twilio Verify)

One international long code (~$2/mo); SMS to Colombia ≈ **$0.0592/send** (verified 2026-08-23);
cost ≈ one send per publisher, once. The checklist, none of it skippable:

- 6-digit code, stored **hashed**, 5-minute expiry, max 3 attempts, invalidated on success
- Resend cooldown 60 s; max 4 sends per number per day; per-device and per-IP throttles (same
  rate-limit machinery the flows already use)
- Numbers validated **before any send**: libphonenumber format check client-side, server re-check,
  country + mobile-pattern rules from `supported_countries` (v1: +57, ten digits starting with 3)
- **Daily SMS spend alarm** — sends × $0.06 above a few dollars/day means pumping; page us
- Twilio Verify (+$0.05/verification, managed fraud guard) is the **named escape hatch** if the
  alarm ever fires for real — not installed by default

## Country is configuration, never code

`supported_countries` table: country code, phone prefix, mobile pattern, currency, locale. v1 has
one row (Colombia). Adding a country = one row + a legal review — zero code. This is product
principle 7 ([00](../product/00-product-map.md)); the phone UI above is its first consumer.

## Deferred (rows in [open-items](../open-items.md))

| What | Trigger |
|---|---|
| **WhatsApp OTP** — flip the channel; proves possession *and* WhatsApp in one message, cheaper than SMS | The unverified-WABA pilot (Meta Business portfolio + dedicated number + auto templates; ≤250 msgs/day without Meta verification, scales to 2,000 on quality). An early post-launch task, not a wish |
| **Meta Business Verification** (unlocks WABA scale) | Volume near the unverified caps — same documents as the SAS, so it co-triggers with [03](../product/03-legal-colombia.md)'s company decision |
| **Facebook login** | Measured sign-in drop-off |
| **Apple login** | The App Store stage (guideline 4.8 forces a privacy-login option alongside social logins) |
