import type { Locator, Page } from '@playwright/test'
import { SignIn } from './parts.ts'
import { step } from './step.ts'

/** `/mis-casos`: everything the signed-in person published. */
export class MyCasesPage {
  readonly page: Page
  readonly title: Locator
  readonly signIn: SignIn

  constructor(page: Page) {
    this.page = page
    this.title = page.getByRole('heading', { name: 'Mis casos' })
    this.signIn = new SignIn(page)
  }

  open() {
    return step('Open «Mis casos»', () => this.page.goto('/mis-casos').then(() => undefined))
  }

  /** Signs into the demo account, which owns Luna and holds the found dog. */
  openAsDemoOwner() {
    return step('Open «Mis casos» as the demo owner', async () => {
      await this.open()
      await this.signIn.withGoogle()
    })
  }

  item(title: string) {
    return this.page.getByRole('heading', { name: title })
  }

  /** The status line of a case in the list, e.g. «Ya está en casa». */
  status(text: string) {
    return this.page.getByText(text)
  }

  openCase(title: string) {
    return step(`Open the case «${title}»`, () => this.item(title).click())
  }
}
