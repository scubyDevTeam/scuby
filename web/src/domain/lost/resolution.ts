// docs/product/04 · `resolution` values: what the owner tells us when a case ends.

/** «¿Quién te ayudó?» — asked at the reunion, so reunions through the platform can be counted. */
export const ATTRIBUTIONS = [
  'platform_sighting',
  'platform_claim',
  'platform_share',
  'offline',
  'unknown',
] as const
export type Attribution = (typeof ATTRIBUTIONS)[number]

/** Why an owner deletes an active case. Both end it as `cancelled`; pet and link survive. */
export const CANCEL_REASONS = ['false_alarm', 'duplicate'] as const
export type CancelReason = (typeof CANCEL_REASONS)[number]

/**
 * The attribution to suggest: a confirmed claim is how it came home; otherwise a sighting the
 * owner starred is the likely lead. A suggestion only — the owner answers.
 */
export function suggestedAttribution(facts: {
  hasConfirmedClaim: boolean
  hasHighlightedSighting: boolean
}): Attribution | null {
  if (facts.hasConfirmedClaim) return 'platform_claim'
  if (facts.hasHighlightedSighting) return 'platform_sighting'
  return null
}
