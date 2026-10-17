import type { Page } from '@playwright/test'
import { step } from './step.ts'

/**
 * The phone's signal. `lose()` is the browser's own offline mode: `navigator.onLine` turns false,
 * `offline` fires, and the network is really cut. Two things about the e2e build shape the rest:
 *
 * - The API is the emulated backend, answered from MSW's service worker inside the page. A fetch
 *   the worker answers still succeeds offline, so «no signal» is what the app is told — the event
 *   and `onLine` — never a fetch that happens to fail. The app does not try while it is offline,
 *   which is the behaviour under test; a fetch dying on one bar is the queue's unit test.
 * - MSW's worker holds the scope the app's shell cache would use (main.tsx), so there is no offline
 *   shell here: with the network truly off, a reload has no page to load. `reopenWithoutSignal()`
 *   therefore leaves the app, brings the network back for the page itself, and keeps the device
 *   saying it has no signal (`navigator.onLine` pinned to false) until `restore()`.
 */
export class Signal {
  readonly page: Page
  private pinned = false

  constructor(page: Page) {
    this.page = page
  }

  lose() {
    return step('Lose the signal', () => this.page.context().setOffline(true))
  }

  /** The tab is closed and the app opened again from its link, with still no signal. */
  reopenWithoutSignal(path: string) {
    return step(`Open ${path} again, still without signal`, async () => {
      await this.page.goto('about:blank')
      await this.page.addInitScript(() => {
        const radio = { online: false }
        Object.assign(window, { __radio: radio })
        Object.defineProperty(Navigator.prototype, 'onLine', {
          configurable: true,
          get: () => radio.online,
        })
      })
      this.pinned = true
      await this.page.context().setOffline(false)
      await this.page.goto(path)
    })
  }

  restore() {
    return step('Get the signal back', async () => {
      if (!this.pinned) return this.page.context().setOffline(false)
      await this.page.evaluate(() => {
        ;(window as unknown as { __radio: { online: boolean } }).__radio.online = true
        window.dispatchEvent(new Event('online'))
      })
    })
  }
}
