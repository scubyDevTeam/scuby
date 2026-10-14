// docs/product/04 · Case state machine. Advisory (frontend.md · Rule 2): it decides what the UI
// offers; the server decides what happens.
import { durations } from '../shared/time'

export type LostStatus = 'active' | 'reunited' | 'expired' | 'cancelled'

export type LostEvent =
  | { type: 'activity' } // sighting, recovery claim, check-in «sigue perdida»
  | { type: 'owner_confirms_reunited' }
  | { type: 'checkins_unanswered' } // two consecutive
  | { type: 'owner_cancels' }
  | { type: 'owner_reopens'; at: Date }

export type LostCaseState = {
  status: LostStatus
  /** When the case left `active`. Null while active. */
  resolvedAt: Date | null
}

/** An expired case is reopenable for 30 days; after that it is purged. */
export const REOPEN_WINDOW_MS = 30 * durations.DAY

/** The next status, or null when the diagram has no such arrow. */
export function transition(state: LostCaseState, event: LostEvent): LostStatus | null {
  switch (state.status) {
    case 'active':
      switch (event.type) {
        case 'activity':
          return 'active'
        case 'owner_confirms_reunited':
          return 'reunited'
        case 'checkins_unanswered':
          return 'expired'
        case 'owner_cancels':
          return 'cancelled'
        default:
          return null
      }
    case 'expired':
      if (event.type === 'owner_reopens' && canReopen(state, event.at)) return 'active'
      return null
    case 'reunited':
    case 'cancelled':
      return null
  }
}

export function canReopen(state: LostCaseState, now: Date): boolean {
  if (state.status !== 'expired' || state.resolvedAt === null) return false
  return now.getTime() - state.resolvedAt.getTime() <= REOPEN_WINDOW_MS
}
