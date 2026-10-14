// Sign-in and the account (docs/eng/auth.md). The session itself travels in an httpOnly cookie
// (O12): no endpoint returns a token, and every request is sent with credentials.
import * as z from 'zod/mini'
import { phone } from './primitives'

export const userWire = z.object({
  id: z.string(),
  display_name: z.string(),
  email: z.string(),
  /** The publisher's verified number, E.164. Null until a first publish verifies one. */
  phone: z.nullable(phone),
})

export type User = { id: string; displayName: string; email: string; phone: string | null }

export function parseUser(raw: unknown): User {
  const wire = userWire.parse(raw)
  return { id: wire.id, displayName: wire.display_name, email: wire.email, phone: wire.phone }
}

const email = z.string().check(z.regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/))

export const emailStartRequest = z.object({ email })
export const emailVerifyRequest = z.object({
  email,
  code: z.string().check(z.regex(/^\d{6}$/)),
})
/** The ID token Google's one-tap hands the page; the server verifies it. */
export const googleSignInRequest = z.object({ credential: z.string().check(z.minLength(1)) })

/** Per-journey switches (docs/product/08 · Global rules · Unsubscribe). */
const notificationPrefs = z.object({
  lost: z.boolean(),
  found: z.boolean(),
  adoption: z.boolean(),
  help: z.boolean(),
})

export const profileWire = z.object({
  display_name: z.string(),
  email: z.string(),
  phone: z.nullable(phone),
  city: z.nullable(z.string()),
  bio: z.nullable(z.string()),
  notification_prefs: notificationPrefs,
})

/** Every field optional: send what changed. The email is the login identity and is not editable. */
export const profileUpdateRequest = z.object({
  display_name: z.optional(z.string().check(z.minLength(1), z.maxLength(80))),
  city: z.optional(z.nullable(z.string().check(z.maxLength(80)))),
  /** Plain text, no links (docs/eng/auth.md · Profile). */
  bio: z.optional(z.nullable(z.string().check(z.maxLength(280)))),
  notification_prefs: z.optional(notificationPrefs),
})

export type Profile = {
  displayName: string
  email: string
  phone: string | null
  city: string | null
  bio: string | null
  notificationPrefs: z.infer<typeof notificationPrefs>
}

export type ProfileUpdate = Partial<
  Pick<Profile, 'displayName' | 'city' | 'bio' | 'notificationPrefs'>
>

export function parseProfile(raw: unknown): Profile {
  const wire = profileWire.parse(raw)
  return {
    displayName: wire.display_name,
    email: wire.email,
    phone: wire.phone,
    city: wire.city,
    bio: wire.bio,
    notificationPrefs: wire.notification_prefs,
  }
}

export const profileUpdateBody = (input: ProfileUpdate): z.input<typeof profileUpdateRequest> => ({
  display_name: input.displayName,
  city: input.city,
  bio: input.bio,
  notification_prefs: input.notificationPrefs,
})

/** One row per install (docs/eng/frontend.md · Push). `fcm` and `apns` arrive with the store apps. */
export const pushSubscriptionRequest = z.object({
  kind: z.enum(['webpush', 'fcm', 'apns']),
  /** Web Push: the PushSubscription as JSON. FCM/APNs: the device token. */
  token: z.string().check(z.minLength(1)),
  device: z.nullable(z.string().check(z.maxLength(200))),
})

export const parseNothing = () => null
