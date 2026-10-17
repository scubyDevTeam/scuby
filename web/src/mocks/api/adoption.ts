// Adoption (docs/product/06): publishing a listing — or converting a found case into one — «Me
// interesa», the lister's moves on the interests, and the listing's endings.
import { api } from '../../contracts/api'
import {
  type AdoptionInterestRow,
  type AdoptionRow,
  db,
  findCase,
  newCode,
  newId,
  type PersonRow,
} from '../db'
import { closeCheckins, onListerInteraction, onListingPublished } from '../followup'
import { notify } from '../notify'
import { fail, route } from '../route'
import { iso, ms, placeName } from '../rules'
import { listingChannels } from '../serialize'
import { verifiedPhone } from './owner'

function listed(code: string, user: PersonRow): AdoptionRow {
  const row = findCase(code) ?? fail('not_found')
  if (row.vertical !== 'adoption') fail('not_found')
  if (row.created_by !== user.id) fail('forbidden')
  return row
}

const petName = (row: AdoptionRow) => db.pets.find((p) => p.id === row.pet_id)?.name ?? 'el animal'

function interestOf(row: AdoptionRow, id: string) {
  return (
    db.adoptionInterests.find((i) => i.id === id && i.case_code === row.code) ?? fail('not_found')
  )
}

/**
 * Ends a listing as adopted: by an interest (`adopted_in_app`, the responsibility moves to that
 * person) or off the platform. Also the email's «ya fue adoptado» (api/links.ts).
 */
export function adopt(row: AdoptionRow, adopter: AdoptionInterestRow | null) {
  const pet = db.pets.find((p) => p.id === row.pet_id)
  row.status = 'adopted'
  row.resolution = adopter ? 'adopted_in_app' : 'adopted_offline'
  row.resolved_at = iso(Date.now())
  closeCheckins(row.code)
  if (pet) {
    // The lister's link closes. In the app, a new owner link opens for the adopter; off the
    // platform there is no link to open, and none is faked with a placeholder person.
    pet.owner_id = adopter ? adopter.person_id : null
    pet.custody_state = 'claimed'
  }
  if (adopter) adopter.status = 'chosen'
  // Closure to everyone else still waiting — a declined interest reads as open to its person.
  for (const other of db.adoptionInterests) {
    if (other.case_code !== row.code || other === adopter || other.status === 'withdrawn') continue
    notify(
      other.person_id,
      'adoption_case.adopted',
      `${petName(row)} ya fue adoptado. Gracias por interesarte.`,
      row.code,
    )
  }
}

export const adoption = [
  route(api.publishAdoption, ({ user, body }) => {
    const converted = body.from_found_case_code ? findCase(body.from_found_case_code) : null
    if (body.from_found_case_code) {
      if (converted?.vertical !== 'found') fail('not_found')
      if (converted.created_by !== user.id) fail('forbidden')
      // «Publicar en adopción» is one of the day-15 offer's exits (05 · Two clocks), not a door
      // open from day one.
      const confirmed = db.ownershipClaims.some(
        (c) => c.case_code === converted.code && c.status === 'confirmed',
      )
      if (converted.status !== 'active' || ms(converted.hold_offer_at) > Date.now() || confirmed) {
        fail('invalid_transition')
      }
    }
    const phone = verifiedPhone(user, body)
    if (typeof phone !== 'string') return phone

    const code = newCode()
    let petId: string
    if (converted?.vertical === 'found') {
      // Same pet row: the stray's history rides along. Listing is not a transfer — the pet stays
      // unclaimed and the custodian link continues.
      petId = converted.pet_id
      const pet = db.pets.find((p) => p.id === petId)
      if (pet) Object.assign(pet, { ...body.pet })
      converted.status = 'converted'
      converted.resolution = 'converted_to_adoptable'
      converted.resolved_at = iso(Date.now())
      converted.successor_case_code = code
    } else {
      petId = newId('pet-')
      const owner = body.lister_role === 'owner'
      db.pets.push({
        id: petId,
        owner_id: owner ? user.id : null,
        chip_number: null,
        custody_state: owner ? 'claimed' : 'unclaimed',
        ...body.pet,
      })
    }

    db.cases[code] = {
      code,
      vertical: 'adoption',
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
      predecessor_case_code: converted?.code ?? null,
      story: body.story,
      temperament: body.temperament,
      requirement_flags: body.requirement_flags,
      requirements: body.requirements,
      lane: 'light',
      location: {
        center: body.location_point,
        radius_m: body.location_radius_m,
        at: iso(Date.now()),
        place_name: placeName(body.location_point),
      },
      external_url: body.external_url,
      trust_tier: 'individual',
    }
    onListingPublished(code)
    return { code }
  }),

  // The row before the channel: count, attribution, and the lister's list (06 · «Me interesa»).
  route(api.expressInterest, ({ params, user, body }) => {
    const row = findCase(params.code) ?? fail('not_found')
    if (row.vertical !== 'adoption') fail('not_found')
    if (row.status !== 'active') fail('invalid_transition')
    if (row.created_by === user.id) fail('forbidden')
    const phone = verifiedPhone(user, body)
    if (typeof phone !== 'string') return phone

    const existing = db.adoptionInterests.find(
      (i) => i.case_code === row.code && i.person_id === user.id,
    )
    // One interest per person per listing: asking again reopens the same conversation.
    if (existing) {
      if (existing.status === 'withdrawn') {
        Object.assign(existing, {
          status: 'open',
          intro: body.intro,
          contact_phone: phone,
          phone_has_whatsapp: body.phone_has_whatsapp,
        })
      }
      return { id: existing.id, ...listingChannels(row) }
    }
    const id = newId('int-')
    db.adoptionInterests.push({
      id,
      case_code: row.code,
      person_id: user.id,
      kind: 'interest',
      form_data: null,
      intro: body.intro,
      contact_phone: phone,
      phone_has_whatsapp: body.phone_has_whatsapp,
      status: 'open',
      created_at: iso(Date.now()),
      first_responded_at: null,
    })
    notify(
      row.created_by,
      'adoption_interest.created',
      `Alguien está interesado en ${petName(row)}.`,
      row.code,
    )
    return { id, ...listingChannels(row) }
  }),

  // Silent by design: the list just updates (08 · Adoption).
  route(api.withdrawInterest, ({ params, user }) => {
    const row = findCase(params.code) ?? fail('not_found')
    if (row.vertical !== 'adoption') fail('not_found')
    const interest = interestOf(row, params.interestId)
    if (interest.person_id !== user.id) fail('forbidden')
    if (interest.status === 'withdrawn' || row.status !== 'active') fail('invalid_transition')
    interest.status = 'withdrawn'
    return { id: interest.id }
  }),

  route(api.answerInterest, ({ params, user, body }) => {
    const row = listed(params.code, user)
    if (row.status !== 'active') fail('invalid_transition')
    const interest = interestOf(row, params.interestId)
    if (interest.status === 'withdrawn' || interest.status === body.status) {
      fail('invalid_transition')
    }
    if (body.status === 'chosen') {
      // One at a time: «no se concretó» on the current one comes first.
      const chosen = db.adoptionInterests.some(
        (i) => i.case_code === row.code && i.status === 'chosen',
      )
      if (chosen) fail('invalid_transition')
      notify(
        interest.person_id,
        'adoption_interest.chosen',
        `Te eligieron para adoptar a ${petName(row)}. Coordina la entrega.`,
        row.code,
      )
    }
    interest.status = body.status
    interest.first_responded_at ??= iso(Date.now())
    // Choosing and «no se concretó» are the lister speaking; a silent decline is not an answer.
    if (body.status !== 'declined') onListerInteraction(row.code)
    return { id: interest.id }
  }),

  // `adopted` is a responsibility transfer, recorded honestly (06).
  route(api.recordAdoption, ({ params, user, body }) => {
    const row = listed(params.code, user)
    if (row.status !== 'active') fail('invalid_transition')
    const adopter = body.interest_id ? interestOf(row, body.interest_id) : null
    if (adopter?.status === 'withdrawn') fail('invalid_transition')
    adopt(row, adopter)
    return { id: row.code }
  }),

  // Expiry and withdrawal never change who is responsible (01 · rule 7).
  route(api.withdrawAdoption, ({ params, user, body }) => {
    const row = listed(params.code, user)
    if (row.status !== 'active') fail('invalid_transition')
    row.status = 'withdrawn'
    row.resolution = body.resolution
    row.resolved_at = iso(Date.now())
    closeCheckins(row.code)
    return { id: row.code }
  }),
]
