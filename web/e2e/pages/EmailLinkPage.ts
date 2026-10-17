import type { Locator, Page } from '@playwright/test'
import { step } from './step.ts'

/**
 * Buttons of the seeded check-ins' emails, as src/mocks/api/links.ts · DEMO_LINKS derives them
 * (a keyed hash of check-in and answer; a unit test there holds these equal).
 */
export const DEMO_LINK_TOKENS = {
  /** Misha's «Sigue disponible»: safe, the demo account's listing. */
  mishaStillAvailable: '1d6wc5o0mddvnj',
  /** Milo's «Ya apareció»: consequential, Julián's lost dog. */
  miloReunited: '1sl8znh06absty',
} as const

/**
 * `/r/<token>`: where an email's one-tap button lands (docs/eng/comms.md · The scanner rule) — and
 * the same question's in-app surface, the banner on home.
 */
export class EmailLinkPage {
  readonly page: Page
  readonly homeBanner: Locator

  constructor(page: Page) {
    this.page = page
    this.homeBanner = page.getByRole('region', { name: 'Pregunta pendiente' })
  }

  open(token: string) {
    return step('Open an email button', () => this.page.goto(`/r/${token}`).then(() => undefined))
  }

  /** What a mail scanner does: fetch the page again, without tapping anything. */
  reopen() {
    return step('Open the same button again', () => this.page.reload().then(() => undefined))
  }

  openHome() {
    return step('Open home', () => this.page.goto('/').then(() => undefined))
  }

  heading(name: string) {
    return this.page.getByRole('heading', { name })
  }

  button(name: string) {
    return this.page.getByRole('button', { name })
  }

  confirm(name: string) {
    return step(`Confirm «${name}»`, () => this.button(name).click())
  }

  viewCase(name: string) {
    return step(`Go to the case («${name}»)`, () => this.page.getByRole('link', { name }).click())
  }
}
