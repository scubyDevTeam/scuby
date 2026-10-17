// What a help request offers, by status and by who is looking (07 · Identity ladder).
import { canReopen, type HelpCaseState } from './machine'

export type HelpViewer = 'beneficiary' | 'public'

export type HelpAction =
  | 'pledge' // «Yo ayudo»
  | 'share'
  | 'report_content'
  | 'close_request' // «Ya no necesita ayuda»
  | 'edit' // «Editar aviso»
  | 'reopen'

export type HelpPageMode = 'open' | 'closed' | 'archived'

export function pageMode(state: HelpCaseState): HelpPageMode {
  if (state.status === 'active') return 'open'
  return state.status === 'expired' ? 'archived' : 'closed'
}

export function availableActions(
  state: HelpCaseState,
  viewer: HelpViewer,
  now: Date,
): HelpAction[] {
  if (state.status === 'active') {
    // The beneficiary never offers help to their own request.
    return viewer === 'beneficiary'
      ? ['close_request', 'edit', 'share']
      : ['pledge', 'share', 'report_content']
  }
  if (state.status === 'expired') {
    return viewer === 'beneficiary' && canReopen(state, now) ? ['reopen'] : []
  }
  // Closed or removed: the card and a banner, no actions (10 §1).
  return []
}
