// The follow-up loop's clocks (docs/product/04, 05, 06, 07 · Schedule), shared by the loop
// (followup.ts) and what each viewer is told (serialize.ts). No imports: both depend on it.
import { DAY, HOUR, iso, ms } from './rules'

export const FIRST_CHECKIN = 72 * HOUR
export const CADENCE = 7 * DAY
/** Push, then email 24 h later: after that a check-in counts as unanswered. */
export const ESCALATION = DAY
/** An individual lister: T+7 d, then every 14 d (06 · Cadence by lister type). */
export const LISTING_FIRST_CHECKIN = 7 * DAY
export const LISTING_CADENCE = 14 * DAY
/** A help request: T+7 d, then every 14 d — or the day after a `needed_by`, if sooner (07). */
export const HELP_FIRST_CHECKIN = 7 * DAY
export const HELP_CADENCE = 14 * DAY
/** Custody facts change fast (05 · Schedule): the first «¿sigues con él?» at +48 h, then every 5 days. */
export const FOUND_FIRST_CHECKIN = 48 * HOUR
export const FOUND_CADENCE = 5 * DAY

/**
 * When a case archives if the check-in due at `scheduledAt` and the next one both go unanswered:
 * the next falls due a cadence later, and counts as unanswered once its escalation passes.
 */
export function archivesAt(vertical: 'lost' | 'found' | 'adoption' | 'help', scheduledAt: string) {
  const cadence = {
    lost: CADENCE,
    found: FOUND_CADENCE,
    adoption: LISTING_CADENCE,
    help: HELP_CADENCE,
  }[vertical]
  return iso(ms(scheduledAt) + cadence + ESCALATION)
}
