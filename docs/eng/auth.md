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
  «yo ayudo»). There is never a standalone signup screen.
- Apple gotcha for later: it returns the user's name **only on first authorization** — capture it
  then or lose it. (Apple login itself is deferred — see Deferred.)
- Sessions are long-lived: an opaque token in an httpOnly cookie, stored only as its SHA-256,
  expiring 12 months after sign-in whatever the use (no sliding refresh); sign-out ends it at once.
  Mechanics: [backend.md](backend.md) · Sessions.
- **Email code:** 6 digits, stored as a keyed hash, 5-minute expiry, 3 attempts, a 60 s resend
  cooldown while the current code is live and unused (a used or burned code never blocks a new
  one), at most 10 sends per address per day, and at most 10 per device and 20 per IP over a rolling
  24 h (those two answer "too many requests"); the address is trimmed and lower-cased; otherwise
  starting a sign-in always answers the same (it never reveals whether an account exists). The
  account is named from the address («juan.perez@…» → «Juan Perez») until the person edits it.
- **Google:** the client sends Google's ID token; the server verifies the signature against
  Google's keys, the audience (our client ID), the issuer, the expiry and issue time, requires a
  verified email, keys the account on Google's `sub`, and links a first Google sign-in to the
  account with the same email only if that account has no Google identity yet and the email is
  authoritative (next bullet). No redirect flow, no client secret.
- **When Google may link to an existing account.** Only when Google vouches for *current* control
  of the address: the domain is `gmail.com` or `googlemail.com`, or the token's `hd` (Workspace
  domain) equals the email's domain. A non-authoritative email may still create an account and
  sign in; that account is flagged `person.google_email_authoritative = false`. An account created
  by email code is never linked to a non-authoritative Google identity (the answer is `401`). When
  someone signs in with an email code to an account holding a non-authoritative Google link, the
  server unlinks that Google identity, ends the person's other sessions, clears a phone verified
  meanwhile and deletes pending phone codes: whoever held the account through that link may have
  attached a number of their own. Why: outside Gmail and Workspace, `email_verified` is historical
  (the address may have changed hands), which allows account takeover and pre-hijacking. Rejected:
  link on any verified email (decision 42 in [00](../product/00-product-map.md)).
- **No phone uniqueness.** Two accounts may verify the same number (`person.phone` is not unique):
  the number is a contact channel, not an identity, and shared family phones are common.
- **Until the providers exist** ([O23](../open-items.md)), local, test and staging write email and
  SMS codes to the log; production starts but refuses every send. For e2e runs, addresses on a test
  domain and numbers in a reserved range accept a fixed code and skip the cooldowns and every send
  limit; configuring either under the production profile stops the server at start-up.

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

**Why the publisher's number is OTP-verified** (examined 2026-08-27, kept deliberately): (1) a
typo'd number fails *silently* — helpers reach nothing, the owner just experiences «nobody saw my
dog» and can never tell why; OTP turns that into immediate feedback. (2) We broadcast the exposed
number on a shareable card — amplifying a number the publisher doesn't control would hand
harassers a weapon, so *we amplify it ⇒ we verify it*. (3) A phone per publisher prices fake cases.
Narrowing to "verify only when WhatsApp is exposed" was considered and set aside for now.

**Unverified numbers are trusted enough to act on.** They are format-validated at input
(libphonenumber, country pattern, stored E.164), so the owner-side UI renders a claimant's
collected number as buttons — `[ Abrir WhatsApp ]` (`wa.me`) · `[ Llamar ]` (`tel:`) — never as
inert text to retype. The failure mode of a fake number is one unanswered chat and a dismissed
claim. One caveat for owners who chose `in_app_only`: outreach from their personal phone reveals
their own number, so the claim card says «Al escribirle, esa persona verá tu número» before the
buttons. When the WABA exists, existence validation replaces the checkbox.

**Behind a flag.** OTP at publish is gated by `publisher_phone_otp` (global default **on**,
overridable per account — [feature-flags.md](feature-flags.md)). Off-path: the number is still
required, format-validated and stored E.164 exactly like a claimant's, the case goes live, and
`phone_verified_at` stays null. The number stays unverified until the next publish or change with
the flag on, which runs the OTP step then. Turning the flag off gives up the three reasons above
for that account; it exists for testing and as the kill switch if SMS pumping outruns the alarm.
The frontend never reads the flag. The publish form response tells it `phone_step: otp` or
`unverified`, and it renders the code entry only for `otp`. The flag gates the publish step only; changing the number in settings always verifies it.

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

- 6-digit code, stored as a **keyed hash** (HMAC), 5-minute expiry, max 3 attempts, invalidated on success
- Resend cooldown 60 s; max 4 sends per number per day; per-device (10 per day) and per-IP (20 per
  day) throttles over rolling 24 h; a repeat inside the cooldown answers as if sent, without sending
- A right code is consumed only when the action it unlocks commits (a failed publish leaves it
  usable); a wrong one counts even when the action fails
- Numbers validated **before any send**: libphonenumber format check client-side, server re-check,
  country + mobile-pattern rules from `supported_countries` (v1: +57, ten digits starting with 3)
- **Daily SMS spend alarm** — sends × $0.06 above a few dollars/day means pumping; page us
- Twilio Verify (+$0.05/verification, managed fraud guard) is the **named escape hatch** if the
  alarm ever fires for real — not installed by default

### Known limitations and risks

Accepted or tracked; each is a deliberate tradeoff, not an oversight.

- **Cookie tossing on `device`.** A sibling subdomain can set a duplicate `device` cookie; the server then treats every request as a new device, so anonymous ownership is lost and upload slots stop matching. An availability problem; only renaming it `__Host-device` fixes it, which is a contract change on the client.
- **Victim lockout.** The per-number SMS cap can lock a number's real owner out of verifying. Accepted.
- **Test number range.** The test bypass range +57 300 000 00xx overlaps an assigned number block. Acceptable: production refuses to start with bypasses configured.
- **IPv6.** IP limits key on the full IPv6 address, so one host can rotate within its /64 ([O26](../open-items.md)).
- **JWKS refetch.** An unknown `kid` in a Google token triggers a refetch of Google's keys, and `/auth/google` has no `429` ([O26](../open-items.md)).
- **Logging.** Never log the Google `credential` (the ID token).
- **Sign-out everywhere.** "Sign out everywhere" and unlink delete sessions by `person_id` without an index; the path is rare, so the index waits until it becomes frequent.

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
