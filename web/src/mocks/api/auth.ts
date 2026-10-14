// Sign-in and the account (docs/eng/auth.md).
import { api } from '../../contracts/api'
import { db, newId, type PersonRow } from '../db'
import { DEMO_OWNER_ID } from '../fixtures'
import { Fail, fail, route } from '../route'
import { iso, nameFromEmail } from '../rules'
import { profileView, userView } from '../serialize'
import { signIn, signOut } from '../session'

/** The code the emulated backend accepts, by email and by SMS. The app shows it while mocks are on. */
export const DEMO_CODE = '123456'

function account(email: string): PersonRow {
  const existing = db.persons.find((p) => p.email === email)
  if (existing) return existing
  // The account is born at its first sign-in (docs/eng/auth.md · lazily).
  const created: PersonRow = {
    id: `user-${email}`,
    display_name: nameFromEmail(email),
    email,
    phone: null,
    city: null,
    bio: null,
    notification_prefs: { lost: true, found: true, adoption: true, help: true },
    joined_at: iso(Date.now()),
  }
  db.persons.push(created)
  return created
}

export const auth = [
  route(api.getSession, ({ user }) => userView(user)),

  // Always 204: the answer must not reveal whether the email has an account.
  route(api.startEmailCode, () => null),

  route(api.verifyEmailCode, ({ body }) => {
    if (body.code !== DEMO_CODE) fail('invalid_code')
    const user = account(body.email)
    signIn(user)
    return userView(user)
  }),

  // Any credential works here; the demo Google account owns Luna and holds a found dog.
  route(api.googleSignIn, () => {
    const user = db.persons.find((p) => p.id === DEMO_OWNER_ID) ?? fail('unauthorized')
    signIn(user)
    return userView(user)
  }),

  route(api.signOut, () => {
    signOut()
    return null
  }),

  route(api.getProfile, ({ user }) => profileView(user)),

  route(api.updateProfile, ({ user, body }) => {
    if (body.display_name !== undefined) user.display_name = body.display_name
    if (body.city !== undefined) user.city = body.city
    if (body.bio !== undefined) {
      // Plain text, no links: a bio with a WhatsApp link bypasses contact prefs.
      if (body.bio && /https?:\/\/|wa\.me|www\./i.test(body.bio)) {
        throw new Fail('validation_failed', undefined, { bio: 'Sin enlaces' })
      }
      user.bio = body.bio
    }
    if (body.notification_prefs) user.notification_prefs = body.notification_prefs
    return profileView(user)
  }),

  route(api.registerPush, ({ user, body }) => {
    const existing = db.pushSubscriptions.find((s) => s.token === body.token)
    if (existing) {
      existing.person_id = user.id
      return { id: existing.id }
    }
    const id = newId('push-')
    db.pushSubscriptions.push({ id, person_id: user.id, ...body })
    return { id }
  }),

  route(api.unregisterPush, ({ user, params }) => {
    const index = db.pushSubscriptions.findIndex(
      (s) => s.id === params.id && s.person_id === user.id,
    )
    if (index < 0) fail('not_found')
    db.pushSubscriptions.splice(index, 1)
    return null
  }),
]
