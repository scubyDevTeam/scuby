// Found (docs/product/05): matching, publishing, «Es mío» and the custodian's endings.
import { api } from '../../contracts/api'
import { db, type FoundRow, findCase, newCode, newId, type PersonRow } from '../db'
import { closeCheckins, onCustodianInteraction, onFoundPublished } from '../followup'
import { notify } from '../notify'
import { fail, route } from '../route'
import { COLOR, DAY, iso, metres, placeName } from '../rules'
import { openThread } from './conversations'
import { verifiedPhone } from './owner'

const HOLD = 15 * DAY
const MATCH_RADIUS_M = 5_000

function held(code: string, user: PersonRow): FoundRow {
  const row = findCase(code) ?? fail('not_found')
  if (row.vertical !== 'found') fail('not_found')
  if (row.created_by !== user.id) fail('forbidden')
  return row
}

const resolutionOf = {
  reunited: 'reunited_owner',
  kept: 'kept_by_finder',
  transferred_to_org: 'transferred_to_org',
} as const

export const found = [
  // A stand-in for the matching algorithm (O7): same species, within 5 km, still being searched for.
  route(api.matchAnimal, ({ body }) => ({
    candidates: Object.values(db.cases).flatMap((row) => {
      if (row.vertical !== 'lost' || row.status !== 'active') return []
      const pet = db.pets.find((p) => p.id === row.pet_id)
      if (!pet || pet.species !== body.species) return []
      const away = metres(row.last_seen.center, body.point)
      if (away > MATCH_RADIUS_M) return []
      const shared = pet.colors.find((c) => body.colors.includes(c))
      return [
        {
          code: row.code,
          name: pet.name ?? '',
          photo_url: pet.photo_urls[0] ?? null,
          why: [
            'Misma especie',
            `A ${Math.round(away / 100) * 100} m de donde se perdió`,
            ...(shared ? [`Mismo color: ${COLOR[shared]}`] : []),
          ],
        },
      ]
    }),
  })),

  route(api.publishFound, ({ user, body }) => {
    const phone = verifiedPhone(user, body)
    if (typeof phone !== 'string') return phone
    // Nobody is responsible for a found animal's pet row until someone proves it is theirs.
    const petId = newId('pet-')
    db.pets.push({
      id: petId,
      owner_id: null,
      name: null,
      chip_number: null,
      custody_state: 'unclaimed',
      health_flags: [],
      ...body.pet,
    })
    const code = newCode()
    db.cases[code] = {
      code,
      vertical: 'found',
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
      found: {
        center: body.found_point,
        radius_m: body.found_radius_m,
        at: body.found_at,
        place_name: placeName(body.found_point),
      },
      holding_where: body.holding_where,
      held_since: body.found_at,
      hold_offer_at: iso(new Date(body.found_at).getTime() + HOLD),
      withheld_detail: body.withheld_detail,
      org_name: null,
      successor_case_code: null,
    }
    onFoundPublished(code)
    notify(
      user.id,
      'found_case.broadcast_sent',
      'Tu aviso ya llegó a los vecinos de la zona.',
      code,
    )
    return { code }
  }),

  // «Es mío» is never anonymous: it asks to take an animal. The row exists before any channel opens.
  route(api.claimOwnership, ({ params, user, body }) => {
    const row = findCase(params.code) ?? fail('not_found')
    if (row.vertical !== 'found') fail('not_found')
    if (row.status !== 'active') fail('invalid_transition')
    const ownLost = Object.values(db.cases).find(
      (c) => c.vertical === 'lost' && c.created_by === user.id && c.status === 'active',
    )
    const id = newId('own-')
    db.ownershipClaims.push({
      id,
      case_code: row.code,
      claimant_id: user.id,
      created_at: iso(Date.now()),
      status: 'open',
      evidence_notes: body.evidence_notes,
      chip_number: body.chip_number,
      photo_urls: body.photo_urls,
      // Only a lost case published before the found one counts as the claimant's evidence (05).
      from_lost_case_code: ownLost && ownLost.published_at < row.published_at ? ownLost.code : null,
    })
    openThread({
      caseCode: row.code,
      startedBy: user.id,
      otherId: row.created_by,
      topic: 'reclamo «Es mío»',
      label: 'Mensaje automático · evidencia de «Es mío»',
      body: body.evidence_notes
        ? `Lo que dijo para identificarlo: «${body.evidence_notes}».`
        : 'Dice que es suyo. Escríbele para confirmarlo.',
      photoUrls: body.photo_urls,
    })
    notify(
      row.created_by,
      'ownership_claim.opened',
      'Alguien dice ser el dueño. Ábrelo para ver lo que envió.',
      row.code,
    )
    const whatsapp = row.contact_prefs.expose_whatsapp && row.phone_has_whatsapp
    return {
      id,
      whatsapp_url: whatsapp ? `https://wa.me/${row.contact_phone.replace('+', '')}` : null,
    }
  }),

  route(api.answerOwnershipClaim, ({ params, user, body }) => {
    const row = held(params.code, user)
    const claim = db.ownershipClaims.find(
      (c) => c.id === params.claimId && c.case_code === row.code,
    )
    if (!claim) fail('not_found')
    if (claim.status !== 'open' && !(claim.status === 'stale' && body.status === 'confirmed')) {
      fail('invalid_transition')
    }
    claim.status = body.status
    if (body.status === 'confirmed') {
      notify(
        claim.claimant_id,
        'ownership_claim.confirmed',
        '¡Confirmaron que es tuyo! Coordina la entrega.',
        row.code,
      )
    }
    return { id: claim.id }
  }),

  route(api.resolveFound, ({ params, user, body }) => {
    const row = held(params.code, user)
    if (row.status !== 'active') fail('invalid_transition')
    if (body.outcome === 'keep_searching') {
      row.hold_offer_at = iso(Date.now() + HOLD)
      onCustodianInteraction(row.code)
      return { id: row.code }
    }
    closeCheckins(row.code)
    row.status = body.outcome
    row.resolved_at = iso(Date.now())
    row.resolution =
      body.outcome === 'cancelled' ? (body.resolution ?? 'duplicate') : resolutionOf[body.outcome]
    row.resolution_attribution = body.outcome === 'reunited' ? body.resolution_attribution : null
    row.org_name = body.outcome === 'transferred_to_org' ? body.org_name : null
    // Responsibility moves with the animal: to the confirmed claimant, or to the finder who keeps it.
    const pet = db.pets.find((p) => p.id === row.pet_id)
    const confirmed = db.ownershipClaims.find(
      (c) => c.case_code === row.code && c.status === 'confirmed',
    )
    if (pet && body.outcome === 'reunited' && confirmed) {
      pet.owner_id = confirmed.claimant_id
      pet.custody_state = 'claimed'
    }
    if (pet && body.outcome === 'kept') {
      pet.owner_id = user.id
      pet.custody_state = 'claimed'
    }
    return { id: row.code }
  }),
]
