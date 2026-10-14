// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { installHintShown, markInstallHintShown, pushSupport, subscribePush } from './push'

const KEY =
  'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U'
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/141.0 Mobile'
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Safari'

const subscription = {
  endpoint: 'https://push.example.test/s/1',
  toJSON: () => ({ endpoint: 'https://push.example.test/s/1', keys: { p256dh: 'p', auth: 'a' } }),
}

function device(options: {
  userAgent?: string
  standalone?: boolean
  push?: boolean
  permission?: NotificationPermission
  existing?: typeof subscription | null
}) {
  const subscribe = vi.fn().mockResolvedValue(subscription)
  const pushManager = {
    getSubscription: vi.fn().mockResolvedValue(options.existing ?? null),
    subscribe,
  }
  vi.stubGlobal('navigator', {
    userAgent: options.userAgent ?? ANDROID,
    maxTouchPoints: 5,
    standalone: options.standalone,
    ...(options.push === false
      ? {}
      : { serviceWorker: { ready: Promise.resolve({ pushManager }) } }),
  })
  vi.stubGlobal('matchMedia', () => ({ matches: options.standalone === true }))
  if (options.push !== false) {
    vi.stubGlobal('PushManager', class {})
    vi.stubGlobal(
      'Notification',
      Object.assign(class {}, {
        permission: 'default',
        requestPermission: vi.fn().mockResolvedValue(options.permission ?? 'granted'),
      }),
    )
  }
  return { subscribe, pushManager }
}

describe('platform/push — when Web Push is off', () => {
  it('is off without a VAPID key (a `mock-…` value in .env reads as none)', async () => {
    device({})
    expect(pushSupport(undefined)).toBe('unavailable')
    expect(await subscribePush(undefined)).toBe('unavailable')
  })

  it('is off in a browser without PushManager', () => {
    device({ push: false })
    expect(pushSupport(KEY)).toBe('unavailable')
  })

  it('asks for the home screen on iOS in a Safari tab', async () => {
    device({ userAgent: IPHONE, push: false })
    expect(pushSupport(KEY)).toBe('needs_install')
    expect(await subscribePush(KEY)).toBe('unavailable')
  })

  it('is available on iOS once opened from the home screen', () => {
    device({ userAgent: IPHONE, standalone: true })
    expect(pushSupport(KEY)).toBe('available')
  })
})

describe('platform/push — subscribing', () => {
  it('subscribes with the VAPID key and returns the subscription as the webpush token', async () => {
    const { subscribe } = device({})
    const outcome = await subscribePush(KEY)
    expect(outcome).toEqual({
      kind: 'webpush',
      token: JSON.stringify(subscription.toJSON()),
    })
    const options = subscribe.mock.calls[0]?.[0]
    expect(options.userVisibleOnly).toBe(true)
    expect(options.applicationServerKey).toBeInstanceOf(Uint8Array)
    expect(options.applicationServerKey).toHaveLength(65)
  })

  it('reuses the subscription this install already has', async () => {
    const { subscribe } = device({ existing: subscription })
    expect(await subscribePush(KEY)).toMatchObject({ kind: 'webpush' })
    expect(subscribe).not.toHaveBeenCalled()
  })

  it.each<[NotificationPermission, string]>([
    ['denied', 'denied'],
    ['default', 'dismissed'],
  ])('reports a permission answered «%s» as %s, without subscribing', async (answer, outcome) => {
    const { subscribe } = device({ permission: answer })
    expect(await subscribePush(KEY)).toBe(outcome)
    expect(subscribe).not.toHaveBeenCalled()
  })

  it('says unavailable when the push service refuses', async () => {
    const { subscribe } = device({})
    subscribe.mockRejectedValue(new DOMException('no push service', 'AbortError'))
    expect(await subscribePush(KEY)).toBe('unavailable')
  })
})

describe('platform/push — the install instruction is shown once', () => {
  it('remembers that it was shown', () => {
    localStorage.clear()
    expect(installHintShown()).toBe(false)
    markInstallHintShown()
    expect(installHintShown()).toBe(true)
  })
})
