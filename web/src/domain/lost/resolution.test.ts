import { describe, expect, it } from 'vitest'
import { suggestedAttribution } from './resolution'

describe('04 · resolution_attribution — «¿quién te ayudó?»', () => {
  it('suggests the claim when the owner confirmed one', () => {
    expect(suggestedAttribution({ hasConfirmedClaim: true, hasHighlightedSighting: true })).toBe(
      'platform_claim',
    )
  })

  it('suggests the sighting the owner starred', () => {
    expect(suggestedAttribution({ hasConfirmedClaim: false, hasHighlightedSighting: true })).toBe(
      'platform_sighting',
    )
  })

  it('suggests nothing when there is no lead: the owner says', () => {
    expect(
      suggestedAttribution({ hasConfirmedClaim: false, hasHighlightedSighting: false }),
    ).toBeNull()
  })
})
