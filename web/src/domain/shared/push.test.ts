import { describe, expect, it } from 'vitest'
import { type PushPermission, type PushSupport, pushOffer } from './push'

describe('frontend.md · Push, by platform — what to offer after publishing', () => {
  it.each<[PushSupport, PushPermission, boolean, ReturnType<typeof pushOffer>]>([
    // Android, or iOS from the home screen: ask, unless the browser already answered.
    ['available', 'default', false, 'ask'],
    ['available', 'granted', false, 'register'],
    ['available', 'denied', false, 'none'],
    // iOS in a Safari tab gets nothing: the add-to-home-screen instruction, once.
    ['needs_install', 'default', false, 'install_hint'],
    ['needs_install', 'default', true, 'none'],
    // No push here (not configured, no PushManager): nothing to offer.
    ['unavailable', 'default', false, 'none'],
    ['unavailable', 'granted', false, 'none'],
  ])('%s, permission %s, hint shown %s → %s', (support, permission, installHintShown, offer) => {
    expect(pushOffer({ support, permission, installHintShown })).toBe(offer)
  })

  it('an installed iPhone app asks like any other device: the instruction was the way there', () => {
    expect(pushOffer({ support: 'available', permission: 'default', installHintShown: true })).toBe(
      'ask',
    )
  })
})
