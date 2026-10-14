// docs/product/04 · `case_checkin` and The follow-up loop: which answers the owner is offered.
import type { Viewer } from './actions'
import type { LostCaseState } from './machine'

export type CheckinTrigger = 'time_based' | 'post_recovery_claim'

export type CheckinResponse =
  | 'still_lost'
  | 'reunited'
  | 'delete'
  | 'claim_confirmed'
  | 'claim_dismissed'
  | 'still_verifying'

/**
 * The first three answer a time-based check-in, the last three a claim check-in — in the order
 * the question shows them: «Sigue perdida · Ya apareció · Eliminar», «Sí, es ella · No es ella ·
 * Aún verificando».
 */
export const CHECKIN_ANSWERS: Record<CheckinTrigger, readonly CheckinResponse[]> = {
  time_based: ['still_lost', 'reunited', 'delete'],
  post_recovery_claim: ['claim_confirmed', 'claim_dismissed', 'still_verifying'],
}

/**
 * What the owner is asked, if anything: only the owner, only while the case is active (the
 * server stops asking once it ends). An affordance — the server decides whether the answer fits.
 */
export function checkinAnswers(
  state: LostCaseState,
  viewer: Viewer,
  pending: { trigger: CheckinTrigger } | null,
): readonly CheckinResponse[] {
  if (viewer !== 'owner' || state.status !== 'active' || !pending) return []
  return CHECKIN_ANSWERS[pending.trigger]
}

/**
 * What an answer needs before it is sent. «Ya apareció» goes through the reunion's «¿quién te
 * ayudó?» and «Eliminar» through the reason, exactly as the case's own buttons do; the rest are one
 * tap. «Sí, es ella» needs nothing: a confirmed claim is always `platform_claim`.
 */
export type CheckinStep = 'send' | 'ask_attribution' | 'ask_reason'

export function checkinStep(response: CheckinResponse): CheckinStep {
  if (response === 'reunited') return 'ask_attribution'
  if (response === 'delete') return 'ask_reason'
  return 'send'
}

/**
 * While a time-based check-in waits, closing or deleting the case *is* its answer: the reunion and
 * the delete are sent as `reunited` / `delete` on the check-in, so its row records the answer
 * instead of being cancelled, and the page shows those two buttons once — in the question.
 */
export function closeAnswersCheckin(pending: { trigger: CheckinTrigger } | null): boolean {
  return pending?.trigger === 'time_based'
}
