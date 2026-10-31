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
  expiring 12 months after sign-in whatever the use (no sliding refresh; decision #43 in
  [00](../product/00-product-map.md)); sign-out ends it at once. Mechanics: [backend.md](backend.md) · Sessions.
- **Email code:** 6 digits, stored as a keyed hash, 5-minute expiry, 3 attempts, a 60 s resend
  cooldown while the current code is live and unused (a used or burned code never blocks a new
  one), and **at most 10 sends per address in a rolling 24 h**; there is no cap per device or per IP
  (decision #57 in [00](../product/00-product-map.md)). Past the cooldown or the cap, starting a
  sign-in still answers the same and sends nothing (it never reveals whether an account exists). The
  address is trimmed and lower-cased. A new account's own screens show a placeholder name built from the
  address («juan.perez@…» → «Juan Perez») until the person names themselves; it is never public: a case's
  contact shows «Alguien» until a name is chosen (decision #48). The
  code is sent after the transaction that stores it has returned its connection; a send that fails
  leaves an unused code and the person asks for another (decisions #45, #60).
- **Google:** the client sends Google's ID token; the server verifies the signature against
  Google's keys, the audience (our client ID), the issuer, the expiry and issue time, requires a
  verified email, and keys the account on Google's `sub`. No redirect flow, no client secret.
- **One account per email: Google and the email code point at the same row** (decision #58 in
  [00](../product/00-product-map.md)). What Google may do depends on whether it vouches for *current* control of
  the address (**authoritative**: the domain is `gmail.com` or `googlemail.com`, or the token's `hd`
  (Workspace domain) equals the email's domain). Outside those, `email_verified` is historical (the address
  may have changed hands), which would allow account takeover and pre-hijacking; only the email code proves
  the mailbox.
  - A `sub` already linked signs in to its account.
  - **Authoritative address:** creates the account, or links the existing account with that email if it has no
    Google identity yet (never over another `sub`: that is `401`).
  - **Any other address, no session:** `401`, and nothing is created or linked.
  - **Any other address, with a session of the account whose email is exactly this one** (the person signed in
    with the email code): the Google identity is linked to that account for good; from then on Google alone
    signs in to it.
  - **Any other address, with a session of a different email:** `401`. A link never crosses emails.

  There is no flag on the account and no step that removes a Google link or ends other sessions: an
  email-code sign-in never touches a Google link. The contract has one `401` code, `unauthorized`, for every refusal; a distinct
  code for "sign in with your email code first" is a client-side proposal
  ([api.md](api.md) · Proposals). Rejected: link on any verified email; allow only Gmail.
- **No phone uniqueness.** Two accounts may verify the same number (`person.phone` is not unique):
  the number is a contact channel, not an identity, and shared family phones are common.
- **Until the providers exist** ([O23](../open-items.md)), local, test and staging write email and
  SMS codes to the log; production starts but refuses every send. The log shows the recipient
  masked and the code in clear: an email as its first character, `***@` and the domain, a phone as
  `***` and its last 4 digits (decision #46) — so a reader of staging logs holds live codes but not
  full addresses or numbers. For e2e runs, addresses on a test
  domain and numbers in a reserved range accept a fixed code and skip the cooldowns and every send
  limit; configuring either under the production profile stops the server at start-up.

## Profile

`display_name` (prefilled from OAuth, editable; when the person has not chosen one it is a placeholder derived from the address, which is **never shown publicly** — a public case shows «Alguien» until a name is chosen, [04](../product/04-lost-workflow.md) · Contact visibility; whoever builds the profile update must mark the name as chosen, `person.display_name_chosen`) · `photo?` · `email` (login identity, not editable
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
the flag on, which runs the OTP step then, and **an unverified number is never public**: the case has
no phone contact until it is verified ([04](../product/04-lost-workflow.md) · Contact visibility). Turning the flag off gives up the three reasons above
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
- **The SMS rule (decision #56):** only mobile numbers of a supported country; **60 s between sends**
  to a number, and a repeat inside that window answers as sent, without sending; **at most 5 sends per
  number in a rolling 24 h** (the sixth answers "too many requests"), counted over every send to the number
  whichever account asked. There is no cap per account, device or IP: the country restriction is what stops
  pumping to other destinations.
- A right code is consumed only when the action it unlocks commits (a failed publish leaves it
  usable); a wrong one counts even when the action fails
- **The SMS is sent like the email:** the code is stored in a transaction and the provider is called after it
  returned, with no transaction open and no pooled connection held (decision #60). A send that fails leaves an
  unused code and answers `server_error`.
- **The caps are not locked.** The count of `code_send` and the insert that follows are separate statements, so
  simultaneous requests for one number (or address) can each read a count under the cap and overshoot it, by up
  to the number of simultaneous requests; later requests see the real count. Accepted (decision #59,
  [backend.md](backend.md) · Concurrency): one extra SMS costs cents, and the daily alarm and the flag cover pumping.
- Numbers validated **before any send**: libphonenumber format check client-side, server re-check,
  country + mobile-pattern rules from `supported_countries` (v1: +57, ten digits starting with 3)
- **Daily SMS spend alarm** — sends × $0.06 above a few dollars/day means pumping; page us. The backend logs
  `sms.daily_send_alarm` over a configured count; a New Relic alert on the daily count, with the
  `publisher_phone_otp` flag as the kill switch, is [O30](../open-items.md)
- Twilio Verify (+$0.05/verification, managed fraud guard) is the **named escape hatch** if the
  alarm ever fires for real — not installed by default

### Known limitations and risks

Accepted or tracked; each is a deliberate tradeoff, not an oversight.

- **Cookie tossing.** A sibling subdomain can set cookies for the parent domain. The session cookie is
  `__Host-session` (browsers refuse a `__Host-` cookie that names a `Domain`), and both cookie readers treat a
  name sent twice as absent, so it cannot be pinned. The device cookie is still `device`: a duplicate pinned
  by a sibling subdomain makes the server treat every request as a new device, so anonymous ownership is lost
  and upload slots stop matching. An availability problem; only renaming it `__Host-device` fixes it, which is
  a contract change on the client side ([O27](../open-items.md)).
- **Origin check on the contract.** An unsafe request from a disallowed origin answers `forbidden` (`403`) before
  it reaches the endpoint ([backend.md](backend.md) · Security), but the contract lists no `403` on the auth and
  phone endpoints ([O27](../open-items.md)).
- **Victim lockout.** Anyone can request codes for a number, so five requests in a rolling 24 h lock its real
  owner out of verifying until the oldest of the five is 24 h old. Accepted. The email channel has the same
  shape: three wrong verifies burn the live code, so the next start sends a new one at once; ten such rounds use
  the address's 10 sends in a rolling 24 h (30 verifies), and the owner gets no code until the oldest of the ten
  is 24 h old. Accepted for now.
- **Send log.** `code_send` keeps the email address or phone number in clear for 30 days (the throttles count
  rows by target); `phone_otp` rows are purged 30 days after they expire. Accepted until a reason to hash the target.
- **Test number range.** The test bypass range +57 300 000 00xx overlaps an assigned number block. Acceptable: production refuses to start with bypasses configured.
- **No IP limits in the backend.** Code sends are limited per number and per address only; per-IP abuse limits, if
  they are needed, belong at the edge, where an IPv6 host can rotate within its /64 ([O26](../open-items.md), [O30](../open-items.md)).
- **JWKS refetch.** An unknown `kid` in a Google token forces a refetch of Google's keys, at most once every 30 s; past that, the token is refused (`401`). A token signed with a freshly rotated key can therefore be refused for up to 30 s, and `/auth/google` has no `429` ([O26](../open-items.md)).
- **Logging.** Never log the Google `credential` (the ID token).
- **Sessions by person.** Account deletion (later) deletes sessions by `person_id`, which has no index; the path is rare, so the index waits until it becomes frequent. Account deletion must also evict the person's cached sessions.

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
