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
    // After «Eliminar mi cuenta» the same Google account comes back as a new, empty one — as it
    // would in production — never as a refusal.
    const user = db.persons.find((p) => p.id === DEMO_OWNER_ID) ?? account('carolina@correo.co')
    signIn(user)
    return userView(user)
  }),

  route(api.deleteAccount, ({ user }) => {
    // Active cases close (a live notice with nobody behind it is worse than none); contributions to
    // other people's cases stay, anonymous; everything personal goes (D14).
    for (const row of Object.values(db.cases)) {
      if (!('created_by' in row) || row.created_by !== user.id || row.status !== 'active') continue
      if (row.vertical === 'lost' || row.vertical === 'found') {
        row.status = 'cancelled'
        row.resolution = 'account_deleted'
      } else if (row.vertical === 'adoption') {
        row.status = 'withdrawn'
        row.resolution = 'no_response'
      } else {
        row.status = 'closed'
        row.resolution = 'no_response'
      }
      row.resolved_at = new Date().toISOString()
    }
    for (const s of db.sightings) if (s.reporter_id === user.id) s.reporter_id = null
    // An ownership claim is a request for an animal, not a contribution: it goes with the person.
    db.ownershipClaims = db.ownershipClaims.filter((c) => c.claimant_id !== user.id)
    for (const i of db.adoptionInterests) {
      if (i.person_id === user.id && i.status === 'open') i.status = 'withdrawn'
    }
    for (const p of db.helpPledges) {
      if (p.person_id === user.id && p.status === 'pledged') p.status = 'withdrawn'
    }
    for (const pet of db.pets) if (pet.owner_id === user.id) pet.owner_id = null
    const threads = db.conversations.filter(
      (c) => c.started_by === user.id || c.other_id === user.id,
    )
    db.messages = db.messages.filter((m) => !threads.some((t) => t.id === m.conversation_id))
    db.conversations = db.conversations.filter((c) => !threads.includes(c))
    db.notifications = db.notifications.filter((n) => n.person_id !== user.id)
    db.pushSubscriptions = db.pushSubscriptions.filter((p) => p.person_id !== user.id)
    db.persons = db.persons.filter((p) => p.id !== user.id)
    signOut()
    return null
  }),

  route(api.startPhoneChange, () => null),

  route(api.verifyPhoneChange, ({ user, body }) => {
    if (body.code !== DEMO_CODE) fail('invalid_code')
    user.phone = body.phone
    return profileView(user)
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
    if (body.photo_url !== undefined) user.photo_url = body.photo_url
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
