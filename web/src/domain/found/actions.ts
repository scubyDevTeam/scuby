// What the found case page offers, by status and by who is looking.
import { canReopen, type FoundCaseState } from './machine'

export type FoundViewer = 'custodian' | 'public'

export type FoundAction =
  | 'claim_ownership' // «Es mío»
  | 'contact_custodian'
  | 'share'
  | 'report_content'
  | 'confirm_reunited' // «Ya está con su dueño»
  | 'keep' // «Me lo quedo»
  | 'transfer_to_org' // «Lo entregué a una fundación»
  | 'cancel'
  | 'edit' // «Editar aviso»
  | 'reopen'

export type FoundPageMode = 'open' | 'closed' | 'archived'

export function pageMode(state: FoundCaseState): FoundPageMode {
  if (state.status === 'active') return 'open'
  return state.status === 'expired' ? 'archived' : 'closed'
}

export function availableActions(
  state: FoundCaseState,
  viewer: FoundViewer,
  now: Date,
): FoundAction[] {
  if (state.status === 'active') {
    return viewer === 'custodian'
      ? ['confirm_reunited', 'keep', 'transfer_to_org', 'edit', 'cancel', 'share']
      : ['claim_ownership', 'contact_custodian', 'share', 'report_content']
  }
  if (state.status === 'expired') {
    return viewer === 'custodian' && canReopen(state, now) ? ['reopen'] : []
  }
  return []
}

/** «Posible dueño» is a badge derived from an open ownership claim, never a status. */
export const hasPossibleOwner = (openClaimCount: number) => openClaimCount > 0
