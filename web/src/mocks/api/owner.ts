// The owner of a lost case: publishing, the case's endings, claims, pins, check-ins, the inbox
// (docs/product/04 · Publishing, state machine, The follow-up loop; 08).
import { api } from '../../contracts/api'
import { db, findCase, type LostRow, newCode, newId, type PersonRow } from '../db'
import {
  closeCheckins,
  closeClaimCheckins,
  onListerInteraction,
  onOwnerInteraction,
  onPublished,
  onStillVerifying,
} from '../followup'
import { notify } from '../notify'
import { Fail, fail, route } from '../route'
import { DAY, iso, ms, placeName } from '../rules'
import {
  ADOPTION_REOPEN_WINDOW,
  myCasesView,
  notificationsView,
  petsView,
  REOPEN_WINDOW,
} from '../serialize'
import { DEMO_CODE } from './auth'

/** The phone step every publish shares (docs/eng/auth.md): verification belongs to the number. */
export function verifiedPhone(
  user: PersonRow,
  body: { phone: string | null; otp_code: string | null },
): string | { phone_step: 'otp' } {
  if (body.phone && body.phone !== user.phone) {
    if (!body.otp_code) return { phone_step: 'otp' }
    if (body.otp_code !== DEMO_CODE) fail('invalid_code')
    user.phone = body.phone
  }
  return body.phone ?? user.phone ?? fail('phone_required')
}

/** The caller's own lost case, or the error that says why not. */
function ownedLost(code: string, user: PersonRow): LostRow {
  const row = findCase(code) ?? fail('not_found')
  if (row.vertical !== 'lost') fail('not_found')
  if (row.created_by !== user.id) fail('forbidden')
  return row
}

const petName = (row: LostRow) => db.pets.find((p) => p.id === row.pet_id)?.name ?? 'tu mascota'

/** Ends a lost case as reunited, and tells everyone who helped (08 · To helpers). */
function reunite(row: LostRow, attribution: string) {
  if (row.status !== 'active') fail('invalid_transition')
  row.status = 'reunited'
  row.resolution = 'reunited_home'
  row.resolution_attribution = attribution
  row.resolved_at = iso(Date.now())
  closeCheckins(row.code)
  const helpers = new Set([
    ...db.sightings
      .filter((s) => s.case_code === row.code && s.status === 'visible')
      .map((s) => s.reporter_id),
    ...db.recoveryClaims.filter((c) => c.case_code === row.code).map((c) => c.claimant_id),
  ])
  for (const id of helpers)
    notify(id, 'lost_case.reunited', `¡${petName(row)} volvió a casa! 🎉`, row.code)
}

function cancel(row: LostRow, resolution: string) {
  if (row.status !== 'active') fail('invalid_transition')
  row.status = 'cancelled'
  row.resolution = resolution
  row.resolved_at = iso(Date.now())
  closeCheckins(row.code)
}

function answerClaim(row: LostRow, claimId: string, status: 'confirmed' | 'dismissed') {
  const claim = db.recoveryClaims.find((c) => c.id === claimId && c.case_code === row.code)
  if (!claim) fail('not_found')
  // A stale claim is the absence of a verdict, not a verdict: it can still be confirmed (04).
  if (claim.status !== 'open' && !(claim.status === 'stale' && status === 'confirmed')) {
    fail('invalid_transition')
  }
  claim.status = status
  closeClaimCheckins(claim.id)
  if (status === 'confirmed') {
    notify(
      claim.claimant_id,
      'recovery_claim.confirmed',
      `¡El dueño confirmó que era ${petName(row)}! Gracias por traerla de vuelta.`,
      row.code,
    )
  }
  return claim
}

const TIME_BASED = ['still_lost', 'reunited', 'delete']

export const owner = [
  route(api.listMyPets, ({ user }) => petsView(db, user.id)),

  route(api.listMyCases, ({ user }) => myCasesView(db, user.id)),

  route(api.publishLost, ({ user, body }) => {
    let petId = body.pet_id
    if (petId) {
      const pet = db.pets.find((p) => p.id === petId && p.owner_id === user.id) ?? fail('not_found')
      // One active case per animal: two would mean two broadcasts and two check-in streams.
      const active = Object.values(db.cases).find(
        (row) => row.vertical === 'lost' && row.pet_id === pet.id && row.status === 'active',
      )
      if (active) fail('active_case_exists', { case_code: active.code })
    }
    const phone = verifiedPhone(user, body)
    if (typeof phone !== 'string') return phone

    // Pet, owner link and case in one transaction: a case without a pet is never a state.
    if (!petId) {
      petId = newId('pet-')
      db.pets.push({
        id: petId,
        owner_id: user.id,
        custody_state: 'claimed',
        health_flags: [],
        ...body.pet,
      })
    }
    const code = newCode()
    db.cases[code] = {
      code,
      vertical: 'lost',
      status: 'active',
      pet_id: petId,
      created_by: user.id,
      published_at: iso(Date.now()),
      resolved_at: null,
      resolution: null,
      resolution_attribution: null,
      contact_prefs: body.contact_prefs,
      contact_phone: phone,
      phone_has_whatsapp: body.phone_has_whatsapp,
      last_seen: {
        center: body.last_seen_point,
        radius_m: body.last_seen_radius_m,
        at: body.last_seen_at,
        place_name: placeName(body.last_seen_point),
      },
    }
    onPublished(code)
    notify(
      user.id,
      'lost_case.broadcast_sent',
      `Tu aviso de ${body.pet.name} ya llegó a los vecinos de la zona.`,
      code,
    )
    return { code }
  }),

  route(api.reuniteCase, ({ params, user, body }) => {
    const row = ownedLost(params.code, user)
    reunite(row, body.resolution_attribution)
    return { id: row.code }
  }),

  route(api.cancelCase, ({ params, user, body }) => {
    const row = ownedLost(params.code, user)
    cancel(row, body.resolution)
    return { id: row.code }
  }),

  // An expired case comes back with its sightings and trajectory: lost and found for 30 days, an
  // adoption listing for 90.
  route(api.reopenCase, ({ params, user }) => {
    const row = findCase(params.code) ?? fail('not_found')
    if (row.vertical === 'help') fail('not_found')
    if (row.created_by !== user.id) fail('forbidden')
    if (row.status !== 'expired' || !row.resolved_at) fail('invalid_transition')
    const window = row.vertical === 'adoption' ? ADOPTION_REOPEN_WINDOW : REOPEN_WINDOW
    if (Date.now() - ms(row.resolved_at) > window) fail('invalid_transition')
    row.status = 'active'
    row.resolved_at = null
    row.resolution = null
    if (row.vertical === 'lost') onOwnerInteraction(row.code)
    if (row.vertical === 'adoption') onListerInteraction(row.code)
    return { id: row.code }
  }),

  route(api.answerRecoveryClaim, ({ params, user, body }) => {
    const row = ownedLost(params.code, user)
    const claim = answerClaim(row, params.claimId, body.status)
    if (row.status === 'active') onOwnerInteraction(row.code)
    return { id: claim.id }
  }),

  route(api.moderateSighting, ({ params, user, body }) => {
    const row = ownedLost(params.code, user)
    const sighting = db.sightings.find(
      (s) => s.id === params.sightingId && s.case_code === row.code,
    )
    if (!sighting) fail('not_found')
    if (body.highlighted !== undefined) {
      if (body.highlighted && !sighting.highlighted_by_owner) {
        notify(
          sighting.reporter_id,
          'sighting.highlighted',
          `El dueño de ${petName(row)} marcó tu avistamiento como útil.`,
          row.code,
        )
      }
      sighting.highlighted_by_owner = body.highlighted
    }
    if (body.hidden !== undefined) sighting.status = body.hidden ? 'hidden_by_owner' : 'visible'
    if (row.status === 'active') onOwnerInteraction(row.code)
    return { id: sighting.id }
  }),

  route(api.answerCheckin, ({ params, user, body }) => {
    const listing = findCase(params.code)
    if (listing?.vertical === 'adoption') {
      // «Sigue disponible» is the one-tap answer (06); the endings have their own endpoints.
      if (listing.created_by !== user.id) fail('forbidden')
      const checkin = db.checkins.find(
        (c) => c.id === params.checkinId && c.case_code === listing.code,
      )
      if (!checkin) fail('not_found')
      if (checkin.responded_at || checkin.cancelled_at || listing.status !== 'active') {
        fail('invalid_transition')
      }
      if (body.response !== 'still_available') {
        throw new Fail('validation_failed', undefined, {
          response: `«${body.response}» does not answer an adoption check-in`,
        })
      }
      checkin.responded_at = iso(Date.now())
      checkin.response = body.response
      onListerInteraction(listing.code)
      return { id: checkin.id }
    }
    const row = ownedLost(params.code, user)
    const checkin = db.checkins.find((c) => c.id === params.checkinId && c.case_code === row.code)
    if (!checkin) fail('not_found')
    if (checkin.responded_at || checkin.cancelled_at || row.status !== 'active') {
      fail('invalid_transition')
    }
    const fitsTrigger =
      body.response !== 'still_available' &&
      TIME_BASED.includes(body.response) === (checkin.trigger === 'time_based')
    if (!fitsTrigger) {
      throw new Fail('validation_failed', undefined, {
        response: `«${body.response}» does not answer a ${checkin.trigger} check-in`,
      })
    }
    checkin.responded_at = iso(Date.now())
    checkin.response = body.response

    const claimId = checkin.claim_id ?? ''
    switch (body.response) {
      case 'still_lost':
        break
      case 'reunited':
        reunite(row, body.resolution_attribution ?? 'unknown')
        break
      case 'delete':
        cancel(row, body.resolution ?? 'false_alarm')
        break
      case 'claim_confirmed':
        // «Sí, es ella» confirms the claim and resolves the case (04 · The follow-up loop).
        answerClaim(row, claimId, 'confirmed')
        reunite(row, 'platform_claim')
        break
      case 'claim_dismissed':
        answerClaim(row, claimId, 'dismissed')
        break
      case 'still_verifying': {
        const claim = db.recoveryClaims.find((c) => c.id === claimId)
        if (claim) claim.stale_at = iso(ms(claim.stale_at) + 3 * DAY)
        onStillVerifying(row.code, claimId)
        break
      }
    }
    if (row.status === 'active') onOwnerInteraction(row.code)
    return { id: checkin.id }
  }),

  route(api.listNotifications, ({ user }) => notificationsView(db, user.id)),

  route(api.readNotifications, ({ user, body }) => {
    for (const n of db.notifications) {
      if (n.person_id === user.id && !n.read_at && (!body.ids || body.ids.includes(n.id))) {
        n.read_at = iso(Date.now())
      }
    }
    return null
  }),
]
