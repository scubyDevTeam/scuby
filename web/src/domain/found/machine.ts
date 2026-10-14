// docs/product/05 · Case state machine. Advisory (frontend.md · Rule 2).
import { durations } from '../shared/time'

export type FoundStatus =
  | 'active'
  | 'reunited'
  | 'kept'
  | 'converted'
  | 'transferred_to_org'
  | 'expired'
  | 'cancelled'

export type FoundEvent =
  | { type: 'activity' } // ownership claim, check-in «sigo con él»
  | { type: 'custodian_confirms_handoff' }
  | { type: 'custodian_keeps' }
  | { type: 'adoption_offer_accepted' }
  | { type: 'custodian_hands_to_org' }
  | { type: 'checkins_unanswered' } // two consecutive
  | { type: 'custodian_cancels' }
  | { type: 'custodian_reopens'; at: Date }

export type FoundCaseState = { status: FoundStatus; resolvedAt: Date | null }

export const REOPEN_WINDOW_MS = 30 * durations.DAY

const fromActive: Partial<Record<FoundEvent['type'], FoundStatus>> = {
  activity: 'active',
  custodian_confirms_handoff: 'reunited',
  custodian_keeps: 'kept',
  adoption_offer_accepted: 'converted',
  custodian_hands_to_org: 'transferred_to_org',
  checkins_unanswered: 'expired',
  custodian_cancels: 'cancelled',
}

/** The next status, or null when the diagram has no such arrow. */
export function transition(state: FoundCaseState, event: FoundEvent): FoundStatus | null {
  if (state.status === 'active') return fromActive[event.type] ?? null
  if (state.status === 'expired' && event.type === 'custodian_reopens') {
    return canReopen(state, event.at) ? 'active' : null
  }
  return null
}

export function canReopen(state: FoundCaseState, now: Date): boolean {
  if (state.status !== 'expired' || state.resolvedAt === null) return false
  return now.getTime() - state.resolvedAt.getTime() <= REOPEN_WINDOW_MS
}

/** The hold clock: custody in limbo has a deadline (05 · Two clocks). */
export const HOLD_OFFER_AFTER_MS = 15 * durations.DAY

/** When the first offer falls due. «Sigo buscando al dueño» re-arms it the same distance ahead. */
export const holdOfferAt = (from: Date) => new Date(from.getTime() + HOLD_OFFER_AFTER_MS)

/**
 * At `held_since + 15 days` with no confirmed claim, the custodian is offered a way out of limbo.
 * Independent of the check-in clock: a diligent finder still gets it.
 */
export function holdOfferDue(
  facts: { status: FoundStatus; offerAt: Date; hasConfirmedClaim: boolean },
  now: Date,
): boolean {
  return (
    facts.status === 'active' &&
    !facts.hasConfirmedClaim &&
    now.getTime() >= facts.offerAt.getTime()
  )
}
