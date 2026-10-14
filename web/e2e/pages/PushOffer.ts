import type { Locator, Page } from '@playwright/test'
import { step } from './step.ts'

declare global {
  interface Window {
    /** How many times the page asked for notification permission (the stub below counts). */
    __permissionPrompts?: number
  }
}

/**
 * The offer to be notified, on the screen after publishing (docs/eng/frontend.md · Push).
 *
 * The e2e run uses the emulated backend, so there is no app service worker (MSW's holds the scope)
 * and no real push service: Chrome would need a real VAPID key and Google's servers. The browser's
 * permission prompt and PushManager are replaced at that boundary; everything above it is the app's
 * own — the offer, platform/push, the contract call and the emulated backend that validates it.
 */
export class PushOffer {
  readonly page: Page
  readonly offer: Locator
  readonly done: Locator

  constructor(page: Page) {
    this.page = page
    this.offer = page.getByRole('heading', { name: '¿Te avisamos en este teléfono?' })
    this.done = page.getByText('Listo: te avisaremos en este teléfono.')
  }

  /** A phone whose browser can do Web Push and will say yes when asked. */
  browserSaysYes() {
    return step('Use a browser that can subscribe to Web Push and grants permission', () =>
      this.page.addInitScript(() => {
        let permission: NotificationPermission = 'default'
        window.__permissionPrompts = 0
        Object.defineProperty(Notification, 'permission', { get: () => permission })
        Notification.requestPermission = async () => {
          window.__permissionPrompts = (window.__permissionPrompts ?? 0) + 1
          permission = 'granted'
          return permission
        }
        const endpoint = 'https://push.example.test/e2e'
        const subscription = {
          endpoint,
          toJSON: () => ({ endpoint, expirationTime: null, keys: { p256dh: 'e2e', auth: 'e2e' } }),
        }
        let current: typeof subscription | null = null
        PushManager.prototype.getSubscription = async () => current as never
        PushManager.prototype.subscribe = async () => {
          current = subscription
          return subscription as never
        }
      }),
    )
  }

  permissionPrompts(): Promise<number> {
    return this.page.evaluate(() => window.__permissionPrompts ?? 0)
  }

  /** Taps «Activar avisos»; resolves with what this install sent to the API. */
  enable(): Promise<{ kind: string; token: string; device: string | null }> {
    return step('Turn on alerts', async () => {
      const sent = this.page.waitForRequest(
        (request) =>
          request.method() === 'POST' && request.url().endsWith('/me/push-subscriptions'),
      )
      await this.page.getByRole('button', { name: 'Activar avisos' }).click()
      return (await sent).postDataJSON()
    })
  }
}
