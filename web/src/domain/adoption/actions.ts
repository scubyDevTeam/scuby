// What the adoption page offers, by status and by who is looking (06 · Identity ladder).
import { type AdoptionCaseState, canReopen } from './machine'

export type AdoptionViewer = 'lister' | 'public'

export type AdoptionAction =
  | 'express_interest' // «Me interesa»
  | 'open_conversation' // back to the channel an interest opened
  | 'withdraw_interest' // «Ya no me interesa»
  | 'share'
  | 'report_content'
  | 'record_adoption' // «Ya fue adoptado»
  | 'withdraw_listing' // «Ya no está disponible»
  | 'edit' // «Editar aviso»
  | 'reopen'

export type AdoptionPageMode = 'open' | 'closed' | 'archived'

export function pageMode(state: AdoptionCaseState): AdoptionPageMode {
  if (state.status === 'active') return 'open'
  return state.status === 'expired' ? 'archived' : 'closed'
}

/** The viewer's own interest, as the server tells it (a decline reads as open). */
export type OwnInterest = { status: 'open' | 'chosen' | 'withdrawn' } | null

export function availableActions(
  state: AdoptionCaseState,
  viewer: AdoptionViewer,
  mine: OwnInterest,
  now: Date,
): AdoptionAction[] {
  if (state.status === 'active') {
    if (viewer === 'lister') return ['record_adoption', 'edit', 'withdraw_listing', 'share']
    // One interest per person: tapping again reopens the conversation it opened.
    const interested = mine !== null && mine.status !== 'withdrawn'
    return interested
      ? ['open_conversation', 'withdraw_interest', 'share', 'report_content']
      : ['express_interest', 'share', 'report_content']
  }
  if (state.status === 'expired') {
    return viewer === 'lister' && canReopen(state, now) ? ['reopen'] : []
  }
  // Adopted or withdrawn: the card and a banner, no actions (10 §1).
  return []
}

/**
 * What a reserved listing says to someone who is not the chosen one (06): reservations fall through
 * constantly, so it invites backups instead of closing the door.
 */
export type ReservedNotice = 'chosen_you' | 'backup_invited' | null

export function reservedNotice(reserved: boolean, mine: OwnInterest): ReservedNotice {
  if (mine?.status === 'chosen') return 'chosen_you'
  return reserved ? 'backup_invited' : null
}
