// Help in kind (docs/product/07; decision #26): publishing a request, «Yo ayudo», and what only the
// beneficiary says — what arrived, what is covered, and when it no longer needs help.
import { api } from '../../contracts/api'
import { db, findCase, type HelpRow, newCode, newId, type PersonRow } from '../db'
import { closeCheckins, onBeneficiaryInteraction, onHelpPublished } from '../followup'
import { notify } from '../notify'
import { fail, route } from '../route'
import { iso, placeName, publicName } from '../rules'
import { beneficiaryChannel, needProgress } from '../serialize'
import { verifiedPhone } from './owner'

const NEED_NAMES = {
  foster: 'un hogar temporal',
  transport: 'transporte',
  supplies: 'insumos',
} as const

function requested(code: string): HelpRow {
  const row = findCase(code) ?? fail('not_found')
  if (row.vertical !== 'help') fail('not_found')
  return row
}

/** The beneficiary's own request, or the error that says why not. */
function own(code: string, user: PersonRow): HelpRow {
  const row = requested(code)
  if (row.created_by !== user.id) fail('forbidden')
  return row
}

const petName = (row: HelpRow) => db.pets.find((p) => p.id === row.pet_id)?.name ?? 'tu mascota'

/** Whoever still has an offer waiting is told the request ended (07 · Events). */
function tellOpenPledgers(row: HelpRow, event: string, body: string) {
  const people = new Set(
    db.helpPledges
      .filter((p) => p.case_code === row.code && p.status === 'pledged')
      .map((p) => p.person_id),
  )
  for (const id of people) notify(id, event, body, row.code)
}

function end(row: HelpRow, resolution: HelpRow['resolution']) {
  row.status = 'closed'
  row.resolution = resolution
  row.resolved_at = iso(Date.now())
  closeCheckins(row.code)
  tellOpenPledgers(
    row,
    'help_request.closed',
    `La solicitud de ${petName(row)} ya no está activa. Gracias por ofrecer.`,
  )
}

/** «Ya no necesita ayuda»: what is still open closes with it. Also the email's link (api/links.ts). */
export function closeRequest(row: HelpRow, resolution: HelpRow['resolution']) {
  for (const need of row.needs) if (need.status === 'open') need.status = 'closed'
  end(row, resolution)
}

/** A need is covered when confirmations reach its target; every need covered ends the request. */
function settle(row: HelpRow) {
  for (const need of row.needs) {
    const { confirmed } = needProgress(db, row.code, need.id)
    if (need.status === 'open' && need.target !== null && confirmed >= need.target) {
      need.status = 'covered'
    }
  }
  if (row.needs.every((n) => n.status !== 'open')) end(row, 'covered')
}

export const help = [
  route(api.publishHelp, ({ user, body }) => {
    let petId = body.pet_id
    if (petId) {
      // A pet the beneficiary holds: theirs, or one they keep for someone (05 · custodian).
      const holds = (id: string) =>
        db.pets.some((p) => p.id === id && p.owner_id === user.id) ||
        Object.values(db.cases).some(
          (row) =>
            row.vertical === 'found' &&
            row.pet_id === id &&
            row.created_by === user.id &&
            row.status === 'active',
        )
      if (!holds(petId)) fail('not_found')
    } else if (!body.pet) {
      fail('validation_failed')
    }
    const phone = verifiedPhone(user, body)
    if (typeof phone !== 'string') return phone

    // Pet, owner link and request in one transaction, as every publish.
    if (!petId && body.pet) {
      petId = newId('pet-')
      db.pets.push({
        id: petId,
        owner_id: user.id,
        chip_number: null,
        custody_state: 'claimed',
        health_flags: [],
        ...body.pet,
      })
    }
    const code = newCode()
    const row: HelpRow = {
      code,
      vertical: 'help',
      status: 'active',
      pet_id: petId ?? '',
      created_by: user.id,
      published_at: iso(Date.now()),
      resolved_at: null,
      resolution: null,
      resolution_attribution: null,
      contact_prefs: body.contact_prefs,
      contact_phone: phone,
      phone_has_whatsapp: body.phone_has_whatsapp,
      story: body.story,
      location: {
        center: body.location_point,
        radius_m: body.location_radius_m,
        at: iso(Date.now()),
        place_name: placeName(body.location_point),
      },
      // Publishes immediately, labelled: nothing waits on review (07 · Trust: tiered, not gated).
      trust_tier: 'unverified',
      needs: body.needs.map((need) => ({ id: newId('need-'), status: 'open', ...need })),
    }
    db.cases[code] = row
    onHelpPublished(row)
    return { code }
  }),

  // The row before the channel, as every contact in the product (07 · `help_pledge`).
  route(api.pledgeHelp, ({ params, user, body }) => {
    const row = requested(params.code)
    if (row.status !== 'active') fail('invalid_transition')
    if (row.created_by === user.id) fail('forbidden')
    const need = row.needs.find((n) => n.id === body.need_id) ?? fail('not_found')
    if (need.status !== 'open') fail('invalid_transition')
    const phone = verifiedPhone(user, body)
    if (typeof phone !== 'string') return phone

    const id = newId('pl-')
    db.helpPledges.push({
      id,
      case_code: row.code,
      need_id: need.id,
      person_id: user.id,
      quantity: body.quantity,
      note: body.note,
      contact_phone: phone,
      phone_has_whatsapp: body.phone_has_whatsapp,
      status: 'pledged',
      created_at: iso(Date.now()),
      confirmed_at: null,
    })
    notify(
      row.created_by,
      'help_pledge.created',
      `${publicName(user.display_name)} ofrece ${NEED_NAMES[need.kind]} para ${petName(row)}. Escríbele para coordinar.`,
      row.code,
    )
    return { id, whatsapp_url: beneficiaryChannel(row) }
  }),

  // «Ya no puedo»: only before the beneficiary confirmed it — what arrived, arrived.
  route(api.withdrawPledge, ({ params, user }) => {
    const row = requested(params.code)
    const pledge =
      db.helpPledges.find((p) => p.id === params.pledgeId && p.case_code === row.code) ??
      fail('not_found')
    if (pledge.person_id !== user.id) fail('forbidden')
    if (pledge.status !== 'pledged' || row.status !== 'active') fail('invalid_transition')
    pledge.status = 'withdrawn'
    return { id: pledge.id }
  }),

  // Only the beneficiary confirms: a pledger never marks their own help as done (07).
  route(api.answerPledge, ({ params, user, body }) => {
    const row = own(params.code, user)
    if (row.status !== 'active') fail('invalid_transition')
    const pledge =
      db.helpPledges.find((p) => p.id === params.pledgeId && p.case_code === row.code) ??
      fail('not_found')
    if (pledge.status !== 'pledged') fail('invalid_transition')
    pledge.status = body.status
    if (body.status === 'confirmed') {
      pledge.confirmed_at = iso(Date.now())
      notify(
        pledge.person_id,
        'help_pledge.confirmed',
        `Llegó lo que ofreciste para ${petName(row)}. Gracias.`,
        row.code,
      )
    }
    onBeneficiaryInteraction(row.code)
    settle(row)
    return { id: pledge.id }
  }),

  // How a «lo que puedan» need ends: the beneficiary's word.
  route(api.coverNeed, ({ params, user }) => {
    const row = own(params.code, user)
    if (row.status !== 'active') fail('invalid_transition')
    const need = row.needs.find((n) => n.id === params.needId) ?? fail('not_found')
    if (need.status !== 'open') fail('invalid_transition')
    need.status = 'covered'
    onBeneficiaryInteraction(row.code)
    settle(row)
    return { id: need.id }
  }),

  // «Ya no necesita ayuda»: pet and links untouched; open pledgers are told.
  route(api.closeHelp, ({ params, user, body }) => {
    const row = own(params.code, user)
    if (row.status !== 'active') fail('invalid_transition')
    closeRequest(row, body.resolution)
    return { id: row.code }
  }),
]
