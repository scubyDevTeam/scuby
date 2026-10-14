// What a helper does without an account (docs/product/04 · sighting, recovery_claim; 09).
import { api } from '../../contracts/api'
import { db, findCase, newId, type SightingRow } from '../db'
import { onClaimOpened } from '../followup'
import { notify } from '../notify'
import { fail, route } from '../route'
import { ago, DAY, distance, HOUR, iso, metres, ms } from '../rules'

const MAX_DISTANCE_M = 30_000
const BEFORE_CASE = DAY

/** 1 per 15 min and 5 per day per reporter per case; 20 per day per reporter overall (04). */
function rateLimit(reporter: { id: string | null; key: string }, caseCode: string | null) {
  const mine = db.sightings.filter((s) =>
    reporter.id ? s.reporter_id === reporter.id : s.reporter_key === reporter.key,
  )
  const since = (window: number) => mine.filter((s) => Date.now() - ms(s.created_at) < window)
  const here = (rows: SightingRow[]) => rows.filter((s) => s.case_code === caseCode)
  if (
    (caseCode && here(since(15 * 60_000)).length >= 1) ||
    (caseCode && here(since(DAY)).length >= 5) ||
    since(DAY).length >= 20
  ) {
    fail('rate_limited')
  }
}

export const helpers = [
  route(api.reportSighting, ({ params, body, user, reporterKey }) => {
    const row = findCase(params.code) ?? fail('not_found')
    if (row.vertical !== 'lost' && row.vertical !== 'found') fail('not_found')
    if (row.status !== 'active') fail('invalid_transition')
    const area = row.vertical === 'lost' ? row.last_seen : row.found

    // The same checks the form ran, again: the client is not trusted input (04 · Validation).
    const seenAt = ms(body.seen_at)
    if (seenAt > Date.now() + 5 * 60_000) fail('seen_at_in_future')
    if (seenAt < ms(area.at) - BEFORE_CASE) fail('seen_at_before_case')
    const away = metres(body.point, area.center)
    if (away > MAX_DISTANCE_M) fail('sighting_too_far')
    rateLimit({ id: user?.id ?? null, key: reporterKey }, row.code)

    const id = newId('s-')
    db.sightings.push({
      id,
      case_code: row.code,
      species: null,
      point: body.point,
      seen_at: body.seen_at,
      created_at: iso(Date.now()),
      note: body.note,
      photo_urls: body.photo_urls,
      reporter_id: user?.id ?? null,
      reporter_key: reporterKey,
      contact_phone: body.contact_phone,
      status: 'visible',
      highlighted_by_owner: false,
    })
    if (row.vertical === 'lost') {
      const name = db.pets.find((p) => p.id === row.pet_id)?.name ?? 'tu mascota'
      const late = Date.now() - seenAt > 6 * HOUR
      notify(
        row.created_by,
        'sighting.reported',
        late
          ? `Alguien dice que vio a ${name} ${ago(body.seen_at)}, ${distance(away)} de donde se perdió.`
          : `Alguien vio a ${name} ${ago(body.seen_at)} ${distance(away)} de donde se perdió.`,
        row.code,
      )
    }
    return { id }
  }),

  route(api.reportOrphanSighting, ({ body, user, reporterKey }) => {
    if (ms(body.seen_at) > Date.now() + 5 * 60_000) fail('seen_at_in_future')
    rateLimit({ id: user?.id ?? null, key: reporterKey }, null)
    const id = newId('orphan-')
    db.sightings.push({
      id,
      case_code: null,
      species: body.species,
      point: body.point,
      seen_at: body.seen_at,
      created_at: iso(Date.now()),
      note: body.note,
      photo_urls: body.photo_urls,
      reporter_id: user?.id ?? null,
      reporter_key: reporterKey,
      contact_phone: body.contact_phone,
      status: 'visible',
      highlighted_by_owner: false,
    })
    return { id }
  }),

  // The row exists before the channel opens: the badge appears whatever happens in WhatsApp.
  route(api.claimRecovery, ({ params, body, user }) => {
    const row = findCase(params.code) ?? fail('not_found')
    if (row.vertical !== 'lost') fail('not_found')
    if (row.status !== 'active') fail('invalid_transition')
    const id = newId('claim-')
    const staleAt = onClaimOpened(row.code, id)
    db.recoveryClaims.push({
      id,
      case_code: row.code,
      phone: body.phone,
      claimant_id: user?.id ?? null,
      created_at: iso(Date.now()),
      status: 'open',
      stale_at: staleAt,
    })
    const name = db.pets.find((p) => p.id === row.pet_id)?.name ?? 'tu mascota'
    notify(
      row.created_by,
      'recovery_claim.opened',
      `Alguien dice que tiene a ${name}. Ábrelo para contactar.`,
      row.code,
    )
    const whatsapp = row.contact_prefs.expose_whatsapp && row.phone_has_whatsapp
    return {
      id,
      whatsapp_url: whatsapp ? `https://wa.me/${row.contact_phone.replace('+', '')}` : null,
    }
  }),

  route(api.sendReport, ({ body, user }) => {
    const exists =
      body.target_type === 'sighting'
        ? db.sightings.some((s) => s.id === body.target_id)
        : body.target_type === 'recovery_claim'
          ? db.recoveryClaims.some((c) => c.id === body.target_id)
          : body.target_type === 'ownership_claim'
            ? db.ownershipClaims.some((c) => c.id === body.target_id)
            : Boolean(findCase(body.target_id))
    if (!exists) fail('not_found')
    const id = newId('report-')
    db.reports.push({
      id,
      target_type: body.target_type,
      target_id: body.target_id,
      reason: body.reason,
      note: body.note,
      reporter_id: user?.id ?? null,
      created_at: iso(Date.now()),
    })
    return { id }
  }),

  // Photos are kept inline: the emulation has no storage. The real one is docs/eng/media-pipeline.md.
  route(api.uploadPhoto, async ({ body }) => {
    const bytes = new Uint8Array(await body.arrayBuffer())
    let binary = ''
    for (const byte of bytes) binary += String.fromCharCode(byte)
    return { url: `data:${body.type || 'image/jpeg'};base64,${btoa(binary)}` }
  }),
]
