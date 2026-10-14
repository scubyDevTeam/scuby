// docs/product/06 · Case state machine. Advisory (frontend.md · Rule 2): it decides what the UI
// offers; the server decides what happens.
import { durations } from '../shared/time'

export type AdoptionStatus = 'active' | 'adopted' | 'withdrawn' | 'expired'

export type AdoptionEvent =
  | { type: 'activity' } // an interest, someone chosen, «sigue disponible»
  | { type: 'lister_records_adoption' }
  | { type: 'lister_withdraws' }
  | { type: 'checkins_unanswered' } // two consecutive
  | { type: 'lister_reopens'; at: Date }

export type AdoptionCaseState = { status: AdoptionStatus; resolvedAt: Date | null }

/** Adoption timelines are months, so an expired listing is reopenable for 90 days, not 30. */
export const REOPEN_WINDOW_MS = 90 * durations.DAY

const fromActive: Record<AdoptionEvent['type'], AdoptionStatus | null> = {
  activity: 'active',
  lister_records_adoption: 'adopted',
  lister_withdraws: 'withdrawn',
  checkins_unanswered: 'expired',
  lister_reopens: null,
}

/** The next status, or null when the diagram has no such arrow. */
export function transition(state: AdoptionCaseState, event: AdoptionEvent): AdoptionStatus | null {
  if (state.status === 'active') return fromActive[event.type]
  if (state.status === 'expired' && event.type === 'lister_reopens') {
    return canReopen(state, event.at) ? 'active' : null
  }
  return null
}

export function canReopen(state: AdoptionCaseState, now: Date): boolean {
  if (state.status !== 'expired' || state.resolvedAt === null) return false
  return now.getTime() - state.resolvedAt.getTime() <= REOPEN_WINDOW_MS
}

// --- adoption_interest ---

export type InterestStatus = 'open' | 'chosen' | 'declined' | 'withdrawn'

/**
 * The lister's moves on one interest (06 · What the lister sees). «Elegir» only while nobody else
 * is chosen — «no se concretó» comes first; nothing un-chooses on its own.
 */
export type InterestMove = 'choose' | 'decline' | 'fell_through' | 'restore'

export function interestMoves(status: InterestStatus, someoneChosen: boolean): InterestMove[] {
  switch (status) {
    case 'open':
      return someoneChosen ? ['decline'] : ['choose', 'decline']
    case 'chosen':
      return ['fell_through']
    case 'declined':
      return ['restore']
    case 'withdrawn':
      return []
  }
}

/** What each move asks the server for. */
export const MOVE_STATUS: Record<InterestMove, 'chosen' | 'declined' | 'open'> = {
  choose: 'chosen',
  decline: 'declined',
  fell_through: 'open',
  restore: 'open',
}

/** «En proceso» is `EXISTS interest WHERE status = 'chosen'` — a badge, never a status. */
export const isReserved = (interests: readonly { status: InterestStatus }[]) =>
  interests.some((interest) => interest.status === 'chosen')
