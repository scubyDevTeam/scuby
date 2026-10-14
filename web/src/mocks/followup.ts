// The follow-up loop of a lost case (docs/product/04 · Schedule) and of an adoption listing
// (docs/product/06 · The follow-up loop): check-ins, stale claims, expiry. The real backend runs
// this as a job; the emulation runs it before answering each request.
import { type AdoptionRow, db, type LostRow, newId } from './db'
import { notify } from './notify'
import { DAY, HOUR, iso, ms } from './rules'

const FIRST_CHECKIN = 72 * HOUR
const CADENCE = 7 * DAY
/** Push, then email 24 h later: after that a check-in counts as unanswered. */
const ESCALATION = DAY
const CLAIM_STALE = 7 * DAY
/** An individual lister: T+7 d, then every 14 d (06 · Cadence by lister type). */
const LISTING_FIRST_CHECKIN = 7 * DAY
const LISTING_CADENCE = 14 * DAY

function schedule(
  code: string,
  at: number,
  trigger: 'time_based' | 'post_recovery_claim',
  claimId: string | null = null,
) {
  db.checkins.push({
    id: newId('ck-'),
    case_code: code,
    claim_id: claimId,
    trigger,
    scheduled_at: iso(at),
    responded_at: null,
    cancelled_at: null,
    response: null,
  })
}

const open = (c: (typeof db.checkins)[number]) => !c.responded_at && !c.cancelled_at

export function onPublished(code: string, at = Date.now()) {
  schedule(code, at + FIRST_CHECKIN, 'time_based')
}

/** Claim check-ins at +24 h and +72 h; no verdict in 7 days and the claim goes stale. */
export function onClaimOpened(code: string, claimId: string, at = Date.now()) {
  schedule(code, at + DAY, 'post_recovery_claim', claimId)
  schedule(code, at + 3 * DAY, 'post_recovery_claim', claimId)
  return iso(at + CLAIM_STALE)
}

/** «Aún verificando»: the claim stays open 72 h more, with one more check-in. */
export function onStillVerifying(code: string, claimId: string, at = Date.now()) {
  schedule(code, at + 3 * DAY, 'post_recovery_claim', claimId)
}

/** A verdict on a claim ends its own check-ins. */
export function closeClaimCheckins(claimId: string, at = Date.now()) {
  for (const c of db.checkins) if (c.claim_id === claimId && open(c)) c.cancelled_at = iso(at)
}

/**
 * Answering anything, or acting on the case — not looking at it — resets the clock: pending
 * time-based check-ins are cancelled and a fresh one is scheduled a week out.
 */
export function onOwnerInteraction(code: string, at = Date.now()) {
  for (const c of db.checkins) {
    if (c.case_code === code && c.trigger === 'time_based' && open(c)) c.cancelled_at = iso(at)
  }
  schedule(code, at + CADENCE, 'time_based')
}

export function onListingPublished(code: string, at = Date.now()) {
  schedule(code, at + LISTING_FIRST_CHECKIN, 'time_based')
}

/**
 * Answering «sigue disponible», or an explicit move — choosing someone, «no se concretó» — resets a
 * listing's clock. Views and new interests do not: they are not the lister speaking.
 */
export function onListerInteraction(code: string, at = Date.now()) {
  for (const c of db.checkins) {
    if (c.case_code === code && c.trigger === 'time_based' && open(c)) c.cancelled_at = iso(at)
  }
  schedule(code, at + LISTING_CADENCE, 'time_based')
}

/** A case that ended asks nothing more. */
export function closeCheckins(code: string, at = Date.now()) {
  for (const c of db.checkins) if (c.case_code === code && open(c)) c.cancelled_at = iso(at)
}

function unansweredStreak(code: string, at: number): number {
  const rows = db.checkins
    .filter((c) => c.case_code === code && c.trigger === 'time_based' && ms(c.scheduled_at) <= at)
    .sort((a, b) => ms(b.scheduled_at) - ms(a.scheduled_at))
  let streak = 0
  for (const c of rows) {
    if (c.responded_at || c.cancelled_at) break
    if (ms(c.scheduled_at) + ESCALATION <= at) streak++
  }
  return streak
}

function advance(row: LostRow, at: number) {
  const timeBased = db.checkins.filter(
    (c) => c.case_code === row.code && c.trigger === 'time_based',
  )
  const latest = timeBased.sort((a, b) => ms(b.scheduled_at) - ms(a.scheduled_at))[0]
  // Every 7 days after the last one fell due, for as long as the case is open.
  if (latest && ms(latest.scheduled_at) <= at && !latest.cancelled_at) {
    let next = ms(latest.scheduled_at) + CADENCE
    while (next <= at) {
      schedule(row.code, next, 'time_based')
      next += CADENCE
    }
    schedule(row.code, next, 'time_based')
  }
  // Two unanswered in a row ≈ two weeks of silence: the case expires, softly (reopenable 30 days).
  if (unansweredStreak(row.code, at) >= 2) {
    row.status = 'expired'
    row.resolution = 'no_response'
    row.resolved_at = iso(at)
    closeCheckins(row.code, at)
    notify(
      row.created_by,
      'lost_case.expired',
      'Archivamos tu aviso. Puedes reactivarlo con un toque durante 30 días.',
      row.code,
    )
  }
}

const dayMonth = (at: number) =>
  new Date(at).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' }).replace('.', '')

function advanceListing(row: AdoptionRow, at: number) {
  const timeBased = db.checkins
    .filter((c) => c.case_code === row.code && c.trigger === 'time_based')
    .sort((a, b) => ms(b.scheduled_at) - ms(a.scheduled_at))
  const latest = timeBased[0]
  if (!latest) {
    onListingPublished(row.code, ms(row.published_at))
  } else if (ms(latest.scheduled_at) <= at && !latest.cancelled_at) {
    let next = ms(latest.scheduled_at) + LISTING_CADENCE
    while (next <= at) {
      schedule(row.code, next, 'time_based')
      next += LISTING_CADENCE
    }
    schedule(row.code, next, 'time_based')
  }
  // `unanswered_streak = 2`: ~28 days of silence for an individual. Soft: reopenable for 90 days.
  if (unansweredStreak(row.code, at) >= 2) {
    row.status = 'expired'
    row.resolution = 'no_response'
    row.resolved_at = iso(at)
    closeCheckins(row.code, at)
    const name = db.pets.find((p) => p.id === row.pet_id)?.name ?? 'tu mascota'
    notify(
      row.created_by,
      'adoption_case.expired',
      `Archivamos la publicación de ${name}. Puedes reactivarla con un toque hasta el ${dayMonth(at + 90 * DAY)}.`,
      row.code,
    )
  }
}

export function tick(at = Date.now()) {
  for (const claim of db.recoveryClaims) {
    if (claim.status === 'open' && ms(claim.stale_at) <= at) {
      claim.status = 'stale'
      closeClaimCheckins(claim.id, at)
    }
  }
  for (const row of Object.values(db.cases)) {
    if (row.vertical === 'lost' && row.status === 'active') advance(row, at)
    if (row.vertical === 'adoption' && row.status === 'active') advanceListing(row, at)
  }
}
