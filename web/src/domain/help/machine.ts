// docs/product/07 · Case state machine. Advisory (frontend.md · Rule 2): it decides what the UI
// offers; the server decides what happens.
import { durations } from '../shared/time'

export type HelpStatus = 'active' | 'closed' | 'expired' | 'removed'

export type HelpEvent =
  | { type: 'activity' } // a pledge, a confirmation, «sigue»
  | { type: 'every_need_covered' }
  | { type: 'beneficiary_closes' }
  | { type: 'checkins_unanswered' } // two consecutive
  | { type: 'moderation_removes' }
  | { type: 'beneficiary_reopens'; at: Date }

export type HelpCaseState = { status: HelpStatus; resolvedAt: Date | null }

/** An expired request can be reopened for 30 days, as in lost (07 · The follow-up loop). */
export const REOPEN_WINDOW_MS = 30 * durations.DAY

const fromActive: Record<HelpEvent['type'], HelpStatus | null> = {
  activity: 'active',
  every_need_covered: 'closed',
  beneficiary_closes: 'closed',
  checkins_unanswered: 'expired',
  moderation_removes: 'removed',
  beneficiary_reopens: null,
}

/** The next status, or null when the diagram has no such arrow. */
export function transition(state: HelpCaseState, event: HelpEvent): HelpStatus | null {
  if (state.status === 'active') return fromActive[event.type]
  if (state.status === 'expired' && event.type === 'beneficiary_reopens') {
    return canReopen(state, event.at) ? 'active' : null
  }
  return null
}

export function canReopen(state: HelpCaseState, now: Date): boolean {
  if (state.status !== 'expired' || state.resolvedAt === null) return false
  return now.getTime() - state.resolvedAt.getTime() <= REOPEN_WINDOW_MS
}

// --- help_pledge ---

export type PledgeStatus = 'pledged' | 'confirmed' | 'declined' | 'withdrawn'

/**
 * The beneficiary's moves on a pledge (07 · `help_pledge`): only they confirm — a pledger never marks
 * their own help as done — and a confirmation is final: what arrived, arrived.
 */
export type PledgeMove = 'confirm' | 'decline'

export function pledgeMoves(status: PledgeStatus): PledgeMove[] {
  return status === 'pledged' ? ['confirm', 'decline'] : []
}
