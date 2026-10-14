import type { Locator, Page } from '@playwright/test'
import { step } from './step.ts'

/**
 * The language is the URL's first segment, and Spanish has none (docs/eng/frontend.md · Languages):
 * `/en/perfil` is English, `/perfil` Spanish. Any screen can be opened in any language.
 */
export class Languages {
  readonly page: Page
  readonly document: Locator

  constructor(page: Page) {
    this.page = page
    this.document = page.locator('html')
  }

  open(path: string, locale?: 'en' | 'es') {
    const url = locale ? `/${locale}${path === '/' ? '' : path}` : path
    return step(`Open ${url}`, () => this.page.goto(url).then(() => undefined))
  }

  /** A tab of the phone's bottom bar, by its label in the current language. */
  tab(navigation: string, name: string) {
    return this.page.getByRole('navigation', { name: navigation }).getByRole('link', { name })
  }

  goToTab(navigation: string, name: string) {
    return step(`Go to the «${name}» tab`, () => this.tab(navigation, name).click())
  }

  heading(name: string) {
    return this.page.getByRole('heading', { name })
  }

  /** The other languages are offered by their own names: «Español», «English». */
  switchTo(name: string) {
    return step(`Switch the language to ${name}`, () =>
      this.page.getByRole('link', { name, exact: true }).click(),
    )
  }
}
