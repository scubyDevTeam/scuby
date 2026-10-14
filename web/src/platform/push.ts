// Push for this install (docs/eng/frontend.md · Push, by platform). Scope 1 holds the Web Push
// branch only; the store apps add their `fcm` / `apns` branches here, behind the same return type.
import { env } from '../env'

/** What the backend stores per install (`push_subscription`), whatever the runtime. */
export type PushRegistration = { kind: 'webpush' | 'fcm' | 'apns'; token: string }
/** `dismissed`: the permission prompt was closed without an answer; it can be asked again. */
export type PushOutcome = PushRegistration | 'denied' | 'dismissed' | 'unavailable'
/** `needs_install`: iOS gives Web Push only to an app opened from the home screen (iOS ≥ 16.4). */
export type PushSupport = 'available' | 'needs_install' | 'unavailable'
export type PushPermission = 'default' | 'granted' | 'denied'

const HINT_KEY = 'push.install_hint_shown'
// Without our service worker (the emulated backend's holds the scope) `ready` could wait forever.
const READY_TIMEOUT_MS = 10_000

function isIos(): boolean {
  const { userAgent, maxTouchPoints } = navigator
  // iPadOS asks for desktop sites and says it is a Mac; the touch screen gives it away.
  return /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1)
}

function isInstalled(): boolean {
  if ((navigator as { standalone?: boolean }).standalone === true) return true
  return typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches
}

/** Off when the VAPID key is not configured (`mock-…` in .env), with no PushManager, or on iOS in a tab. */
export function pushSupport(vapidKey: string | undefined = env.vapidPublicKey): PushSupport {
  if (!vapidKey) return 'unavailable'
  if (isIos() && !isInstalled()) return 'needs_install'
  const capable =
    'serviceWorker' in navigator && 'PushManager' in globalThis && 'Notification' in globalThis
  return capable ? 'available' : 'unavailable'
}

export function pushPermission(): PushPermission {
  return 'Notification' in globalThis ? Notification.permission : 'denied'
}

function fromBase64Url(key: string): Uint8Array<ArrayBuffer> {
  const base64 = (key + '='.repeat((4 - (key.length % 4)) % 4))
    .replace(/-/g, '+')
    .replace(/_/g, '/')
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
}

function ready(): Promise<ServiceWorkerRegistration | null> {
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), READY_TIMEOUT_MS)),
  ])
}

/**
 * Asks for permission (a no-op when it was already given) and subscribes this install. Call it from
 * a tap: browsers ignore or bury a permission prompt nobody asked for.
 */
export async function subscribePush(
  vapidKey: string | undefined = env.vapidPublicKey,
): Promise<PushOutcome> {
  if (!vapidKey || pushSupport(vapidKey) !== 'available') return 'unavailable'
  const permission = await Notification.requestPermission()
  if (permission === 'denied') return 'denied'
  if (permission !== 'granted') return 'dismissed'
  const registration = await ready()
  if (!registration) return 'unavailable'
  try {
    const subscription =
      (await registration.pushManager.getSubscription()) ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: fromBase64Url(vapidKey),
      }))
    // The contract's `token` for Web Push: the PushSubscription as JSON (endpoint + keys).
    return { kind: 'webpush', token: JSON.stringify(subscription) }
  } catch {
    return 'unavailable'
  }
}

/** The add-to-home-screen instruction is shown once per device (frontend.md · Push). */
export function installHintShown(): boolean {
  try {
    return localStorage.getItem(HINT_KEY) === '1'
  } catch {
    return false
  }
}

export function markInstallHintShown(): void {
  try {
    localStorage.setItem(HINT_KEY, '1')
  } catch {
    // Private mode: the instruction may show again, which is harmless.
  }
}
