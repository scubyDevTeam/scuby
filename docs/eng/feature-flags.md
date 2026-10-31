# Feature Flags

> Decided 2026-09-30. How we turn behavior on and off without a deploy, globally or for one
> account. Sized for two engineers at 10–15 h/week: three small tables and one function, no vendor.

## What a flag is (and is not)

A flag gates **behavior**, never **data shape**. The schema, enum values and endpoints behind a
flag exist whether it is on or off; the flag only decides which code path runs. Turning a flag
off must never require a migration, and turning it back on must never find missing columns.

Not flags:

- **Country specifics** — prefixes, currency, legal posture — are `supported_countries`
  configuration ([auth.md](auth.md)). A flag answers "is this behavior on?", not "what are the
  rules for Colombia?".
- **User preferences** — notification toggles, contact prefs — live on the profile. A flag is
  something *we* decide, never something the user sets.
- **Deferred items** ([open-items](../open-items.md)) — a D-row is not built, so there is nothing
  to flag. A flag wraps code that ships.

## Model

| Table | Columns |
|---|---|
| `feature_flags` | `key` (English snake_case, PK) · `enabled` (the global default) · `description` · `owner` · `created_at` |
| `feature_flag_overrides` | `flag_key` · `person_id` · `enabled` · `reason` · `created_at` — unique on (`flag_key`, `person_id`) |
| `feature_flag_changes` | Append-only history of every flip (below) |

**Evaluation**, one function, server-side only:

```
is_enabled(flag_key, person?) =
    override for (flag_key, person) if one exists
    else feature_flags.enabled
```

- An override can force a flag **on or off** for one account, in either direction from the
  global default — beta-test a feature with the two of us, or exempt one account from one.
- **Anonymous actors get the global value.** There is no account to override (helpers act
  without one — product principle 5, [00](../product/00-product-map.md)).
- An unknown key evaluates to **off** and logs a warning — a typo never silently enables
  something.
- Values are resolved per request by the backend, which already knows the account from the
  session.
- Evaluation reads an in-process snapshot of both tables (`feature_flags`, `feature_flag_overrides`),
  reloaded at most every ~30 s: no SQL per request. A flip takes effect within that window, no deploy.

## Flags are a backend concern

**The backend is the only place a flag is read.** It resolves the account, evaluates the flag and
decides what to do; the frontend never sees flag keys or values. Most flags gate backend behavior
with no UI difference at all (which provider sends, whether a job runs, which rule applies).

When a flag *does* change what a screen shows, the backend expresses the **outcome as data** in
the response the screen already consumes, not as a flag. Example: the publish form response
carries `phone_step: otp | unverified`, not `publisher_phone_otp: true`. The frontend renders what
it is told, and an API response is its whole contract. This keeps the frontend free of flag logic,
lets a flag be removed without a frontend release, and means a tampered client can never switch
behavior on, since the server enforces the action either way.

There is no flag bootstrap payload and no client-side flag SDK. If a future need seems to require
one, it gets its own decision.

**Changing a flag** is an `UPDATE` by an operator (the founders) until an operator screen exists.
Every change, global or override, also writes a `feature_flag_changes` row: `flag_key` ·
`person_id?` · `old` · `new` · `changed_by` · `changed_at`. It is a history table, not an event —
nothing consumes it except us reading it, so it stays out of [08](../product/08-notifications.md)'s
event vocabulary.

## Rules

- **Every flag has an owner and an exit.** The `description` says what it gates and when it gets
  deleted — a launch flag is removed once the feature is stable; an operational kill switch may
  live forever and says so.
- **The registry below is the inventory.** A flag in code but not listed here is a bug.
- **Off is always a supported state.** Both paths of a flag are specified in the owning doc, not
  just the "on" path.

## Registry

| Key | Default | Gates | Off-path | Owning doc | Exit |
|---|---|---|---|---|---|
| `publisher_phone_otp` | **on** | SMS OTP verification of the publisher's phone at publish | Number still required, format-validated and stored E.164, but no OTP; `phone_verified_at` stays null, and the case shows no public phone contact until the number is verified ([04](../product/04-lost-workflow.md) · Contact visibility). The publish form response says `phone_step: unverified`, so the UI skips the code entry | [auth.md · phone step](auth.md) | Permanent kill switch — also the lever if the SMS spend alarm fires before Twilio Verify is installed |
| `reverse_geocoding` | **off** | Place names (`place_name` on cases and feed items) from a reverse-geocoding provider, computed once at publish | A generic localized label («Zona marcada en el mapa») | [backend.md](backend.md) · Place names (added by the lost-case work) | Deleted once a provider is chosen and stable |

## Rejected alternatives

- **Hosted flag service** (LaunchDarkly, Unleash, Flagsmith, PostHog flags) — a vendor, an SDK
  and a bill for what is three small tables at our size. Percentage rollouts and targeting rules are its
  real value, and we have no traffic that needs them.
- **Environment variables / config file** — global only, and a flip needs a redeploy. Fails the
  per-account requirement.
- **Client-side flag evaluation** (flags shipped to the frontend in a bootstrap payload) — puts
  decision logic in two places, couples flag removal to frontend releases, and the server must
  re-check anyway. The frontend receives outcomes as response data instead.
- **Percentage rollouts and segment rules now** — reopen when a single feature needs to reach a
  fraction of real users rather than named accounts.
