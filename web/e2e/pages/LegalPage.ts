import type { Locator, Page } from '@playwright/test'
import { step } from './step.ts'

/** `/terminos` and `/privacidad` (docs/product/03), and the consent line that links them. */
export class LegalPage {
  readonly page: Page
  readonly draft: Locator
  readonly consentTerms: Locator
  readonly consentPrivacy: Locator

  constructor(page: Page) {
    this.page = page
    this.draft = page.getByText('Borrador', { exact: true })
    this.consentTerms = page.getByRole('link', { name: 'Términos', exact: true })
    this.consentPrivacy = page.getByRole('link', { name: 'Política de tratamiento de datos' })
  }

  title(name: string) {
    return this.page.getByRole('heading', { level: 1, name })
  }

  section(name: string) {
    return this.page.getByRole('heading', { level: 2, name })
  }

  openSignIn() {
    return step('Open a screen that asks to sign in', () =>
      this.page.goto('/perfil').then(() => undefined),
    )
  }

  /** The consent line opens the documents in a new tab, so a half-done form survives. */
  readTermsFromConsent() {
    return step('Open the terms from the consent line', async () => {
      const [tab] = await Promise.all([
        this.page.context().waitForEvent('page'),
        this.consentTerms.click(),
      ])
      await tab.waitForLoadState()
      return new LegalPage(tab)
    })
  }

  goToPrivacy() {
    return step('Follow the link to the data policy', () =>
      this.page.getByRole('link', { name: 'Política de tratamiento de datos' }).click(),
    )
  }
}
