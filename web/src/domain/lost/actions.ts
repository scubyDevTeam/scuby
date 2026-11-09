// What the case page offers, by status and by who is looking (frontend.md · Rule 2).
import { canReopen, type LostCaseState } from './machine'

export type Viewer = 'owner' | 'public'

export type LostAction =
  | 'report_sighting' // «La vi»
  | 'claim_recovery' // «La tengo conmigo»
  | 'contact_owner'
  | 'share'
  | 'report_content'
  | 'confirm_reunited'
  | 'cancel'
  | 'reopen'
  | 'edit' // «Editar aviso»: its photos, signs, zone and time

/** docs/product/10 §1: which face of the page a status shows. */
export type LostPageMode = 'open' | 'closed' | 'archived'

export function pageMode(state: LostCaseState): LostPageMode {
  switch (state.status) {
    case 'active':
      return 'open'
    case 'reunited':
    case 'cancelled':
      return 'closed'
    case 'expired':
      return 'archived'
  }
}

export function availableActions(state: LostCaseState, viewer: Viewer, now: Date): LostAction[] {
  switch (state.status) {
    case 'active':
      return viewer === 'owner'
        ? ['confirm_reunited', 'edit', 'cancel', 'share']
        : ['report_sighting', 'claim_recovery', 'contact_owner', 'share', 'report_content']
    case 'expired':
      // Reachable for 30 days: the owner reopens it, and someone who has the animal says so —
      // which reactivates it (decision #29). Sightings wait for the case to be live again.
      if (!canReopen(state, now)) return []
      return viewer === 'owner' ? ['reopen'] : ['claim_recovery', 'share']
    case 'reunited':
    case 'cancelled':
      return []
  }
}

/** «Posible hallazgo» is a badge derived from an open recovery claim, never a status. */
export function hasPossibleFind(openClaimCount: number | null): boolean {
  // null: the viewer is not the owner, who alone sees the badge (decision #76).
  return (openClaimCount ?? 0) > 0
}
