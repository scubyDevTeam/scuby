// When to ask for push (docs/eng/frontend.md · Push, by platform). The domain advises what to
// offer; whether a push is sent, and when, is the backend's (quiet hours, coalescing: 08).

/** What this device can do with Web Push, as `platform/push` reports it. */
export type PushSupport = 'available' | 'needs_install' | 'unavailable'
/** The browser's notification permission. */
export type PushPermission = 'default' | 'granted' | 'denied'

/**
 * - `ask`: offer the button that asks for permission (never on first load: after publishing).
 * - `register`: permission was already given; subscribe quietly, nothing to ask.
 * - `install_hint`: iOS in a Safari tab gets no push — the add-to-home-screen instruction instead.
 * - `none`: nothing to offer.
 */
export type PushOffer = 'ask' | 'register' | 'install_hint' | 'none'

export function pushOffer(device: {
  support: PushSupport
  permission: PushPermission
  /** The install instruction is shown once; after that only the backend repeats it. */
  installHintShown: boolean
}): PushOffer {
  if (device.support === 'unavailable') return 'none'
  if (device.support === 'needs_install') return device.installHintShown ? 'none' : 'install_hint'
  if (device.permission === 'granted') return 'register'
  if (device.permission === 'denied') return 'none'
  return 'ask'
}
