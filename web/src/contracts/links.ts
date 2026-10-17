// The email's one-tap links (docs/eng/comms.md · Actionable check-ins, The scanner rule): each
// button is `/r/<token>`, single-use, expiring, bound to one check-in and one answer. No session —
// the token is the auth, because the person reading the email rarely has one.
import * as z from 'zod/mini'
import { verticalSchema } from './primitives'

/**
 * The answers an email carries, one per button. A lost case's six (04 · The follow-up loop), a
 * listing's «sigue disponible» · «ya fue adoptado» (06) and a request's «sigue» · «ya no necesita
 * ayuda» (07). `adopted` records the interest marked «En proceso», if any, as the adopter.
 */
export const linkResponseSchema = z.enum([
  'still_lost',
  'reunited',
  'delete',
  'claim_confirmed',
  'claim_dismissed',
  'still_verifying',
  'still_available',
  'adopted',
  'still_needed',
  'no_longer_needed',
])

/**
 * `confirm`: a consequential answer, waiting for its one-button page — only the POST acts.
 * `applied`: this request applied it (a safe answer's GET, or the confirming POST).
 * `used`: this link already answered its check-in; opening it again changes nothing.
 * `already_answered`: the question was answered elsewhere (the app, another link) or the case moved
 * on. `expired`: the link outlived its window without being used.
 */
export const linkStateSchema = z.enum(['confirm', 'applied', 'used', 'already_answered', 'expired'])

export const checkinLinkWire = z.object({
  case_code: z.string(),
  vertical: verticalSchema,
  /** The pet's name, or null for an animal without one. */
  pet_name: z.nullable(z.string()),
  photo_url: z.nullable(z.string()),
  response: linkResponseSchema,
  /** Safe answers keep the case as it is and may act on GET; consequential ones never do. */
  kind: z.enum(['safe', 'consequential']),
  state: linkStateSchema,
  /**
   * On a consequential link waiting to be confirmed: the token of the same email's safe button
   * («No, sigue perdida»), so backing out is one tap that answers too. Null otherwise.
   */
  decline_token: z.nullable(z.string()),
})

export type LinkResponse = z.infer<typeof linkResponseSchema>
export type LinkState = z.infer<typeof linkStateSchema>

export type CheckinLink = {
  caseCode: string
  vertical: z.infer<typeof verticalSchema>
  petName: string | null
  photoUrl: string | null
  response: LinkResponse
  kind: 'safe' | 'consequential'
  state: LinkState
  declineToken: string | null
}

export function parseCheckinLink(raw: unknown): CheckinLink {
  const wire = checkinLinkWire.parse(raw)
  return {
    caseCode: wire.case_code,
    vertical: wire.vertical,
    petName: wire.pet_name,
    photoUrl: wire.photo_url,
    response: wire.response,
    kind: wire.kind,
    state: wire.state,
    declineToken: wire.decline_token,
  }
}
