// What a helper does without an account (docs/product/04 · sighting, recovery_claim; 09).
import { api } from '../../contracts/api'
import type { Point } from '../../contracts/primitives'
import { db, type FoundRow, findCase, type LostRow, newId, type SightingRow } from '../db'
import { onClaimOpened, onOwnerInteraction } from '../followup'
import { notify } from '../notify'
import { fail, route } from '../route'
import { ago, DAY, distance, HOUR, iso, metres, ms } from '../rules'
import { EDIT_WINDOW, ownership, REOPEN_WINDOW } from '../serialize'
import { mediaUrl } from './media'

const MAX_DISTANCE_M = 30_000
const BEFORE_CASE = DAY

/** 1 per 15 min and 5 per day per reporter per case; 20 per day per reporter overall (04). */
function rateLimit(reporter: { id: string | null; key: string }, caseCode: string | null) {
  const mine = db.sightings.filter((s) =>
    reporter.id ? s.reporter_id === reporter.id : s.reporter_key === reporter.key,
  )
  const since = (window: number) => mine.filter((s) => Date.now() - ms(s.created_at) < window)
  const here = (rows: SightingRow[]) => rows.filter((s) => s.case_code === caseCode)
  // «Lo vi otra vez» (04 · Second pin): while the earlier pin can still be corrected, a new one is
  // not «hace poco» — the 15-minute rule would always refuse the question's own answer. The daily
  // caps still hold.
  const lastHere = here(mine).sort((a, b) => ms(b.created_at) - ms(a.created_at))[0]
  const askedAbout = lastHere !== undefined && Date.now() - ms(lastHere.created_at) < EDIT_WINDOW
  if (
    (caseCode && !askedAbout && here(since(15 * 60_000)).length >= 1) ||
    (caseCode && here(since(DAY)).length >= 5) ||
    since(DAY).length >= 20
  ) {
    fail('rate_limited')
  }
}

/** The same checks the form ran, again: the client is not trusted input (04 · Validation). */
function checkSighting(row: LostRow | FoundRow, point: Point, seenAtIso: string) {
  const area = row.vertical === 'lost' ? row.last_seen : row.found
  const seenAt = ms(seenAtIso)
  if (seenAt > Date.now() + 5 * 60_000) fail('seen_at_in_future')
  if (seenAt < ms(area.at) - BEFORE_CASE) fail('seen_at_before_case')
  const away = metres(point, area.center)
  if (away > MAX_DISTANCE_M) fail('sighting_too_far')
  return { seenAt, away }
}

/** One's own pin, still inside its correction window (04): anything else is not theirs to change. */
function ownEditable(code: string, id: string, userId: string | null, device: string): SightingRow {
  const sighting =
    db.sightings.find((s) => s.id === id && s.case_code === code) ?? fail('not_found')
  const mine = ownership(sighting, userId, device)
  if (!mine.mine || sighting.status !== 'visible') fail('forbidden')
  if (!mine.editable_until) fail('forbidden')
  return sighting
}

export const helpers = [
  route(api.reportSighting, ({ params, body, user, reporterKey }) => {
    const row = findCase(params.code) ?? fail('not_found')
    if (row.vertical !== 'lost' && row.vertical !== 'found') fail('not_found')
    // A replay (the offline queue retrying a send whose answer never arrived) is the sighting it
    // already made: the same id, no second row, no rate limit — and whatever the case did since.
    const replayed = body.client_id
      ? db.sightings.find((s) => s.case_code === row.code && s.client_id === body.client_id)
      : undefined
    if (replayed) return { id: replayed.id }
    if (row.status !== 'active') fail('invalid_transition')
    const { seenAt, away } = checkSighting(row, body.point, body.seen_at)
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
      ...(body.client_id ? { client_id: body.client_id } : {}),
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
  route(api.correctSighting, ({ params, body, user, reporterKey }) => {
    const row = findCase(params.code) ?? fail('not_found')
    if (row.vertical !== 'lost' && row.vertical !== 'found') fail('not_found')
    const sighting = ownEditable(row.code, params.sightingId, user?.id ?? null, reporterKey)
    if (row.status !== 'active') fail('invalid_transition')
    checkSighting(row, body.point, body.seen_at)
    // No new row: the pin moves, and the reporter's contact and photos stay with it.
    sighting.point = body.point
    sighting.seen_at = body.seen_at
    sighting.note = body.note
    return null
  }),

  route(api.deleteSighting, ({ params, user, reporterKey }) => {
    const row = findCase(params.code) ?? fail('not_found')
    const sighting = ownEditable(row.code, params.sightingId, user?.id ?? null, reporterKey)
    db.sightings.splice(db.sightings.indexOf(sighting), 1)
    return null
  }),

  route(api.claimRecovery, ({ params, body, user }) => {
    const row = findCase(params.code) ?? fail('not_found')
    if (row.vertical !== 'lost') fail('not_found')
    // Someone holding the animal is stronger evidence of a live search than the owner tapping
    // «reabrir» (decision #29): inside the 30-day window, a claim reactivates an archived case.
    const reopens =
      row.status === 'expired' &&
      row.resolved_at !== null &&
      Date.now() - ms(row.resolved_at) <= REOPEN_WINDOW
    if (row.status !== 'active' && !reopens) fail('invalid_transition')
    if (reopens) {
      row.status = 'active'
      row.resolved_at = null
      row.resolution = null
      onOwnerInteraction(row.code)
    }
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

  route(api.recordShare, ({ params, body }) => {
    // A metric, not a feature: an unknown code is not worth an error the client would ignore anyway.
    if (findCase(params.code)) {
      db.shares.push({ case_code: params.code.toUpperCase(), ...body, created_at: iso(Date.now()) })
    }
    return null
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

  // The slot: where the bytes go and where the photo will be (api/media.ts is the storage side).
  // The emulation does not check who may attach which photo; the real backend does (api.md · Uploads).
  route(api.uploadPhoto, async ({ body }) => {
    const url = mediaUrl(body.sha256)
    if (db.media[body.sha256]) return { url, upload: null }
    return {
      url,
      upload: {
        method: 'PUT' as const,
        url,
        headers: { 'content-type': body.content_type },
        expires_at: iso(Date.now() + 5 * 60 * 1000),
      },
    }
  }),
]
