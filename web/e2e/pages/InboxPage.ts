import type { Locator, Page } from '@playwright/test'
import { SignIn } from './parts.ts'
import { step } from './step.ts'

/** `/bandeja`: a copy of every notification sent to the signed-in person, newest first. */
export class InboxPage {
  readonly page: Page
  readonly title: Locator
  readonly items: Locator
  readonly unread: Locator
  /** The «Bandeja» tab of the bottom bar, and the unread count on it. */
  readonly navLink: Locator
  readonly navBadge: Locator
  readonly signIn: SignIn

  constructor(page: Page) {
    this.page = page
    this.title = page.getByRole('heading', { name: 'Bandeja' })
    this.items = page.getByRole('list', { name: 'Avisos' }).getByRole('listitem')
    this.unread = this.items.filter({ hasText: 'Sin leer' })
    this.navLink = page
      .getByRole('navigation', { name: 'Principal' })
      .getByRole('link', { name: /Bandeja/ })
    this.navBadge = this.navLink.getByText(/sin leer/)
    this.signIn = new SignIn(page)
  }

  open() {
    return step('Open «Bandeja»', () => this.page.goto('/bandeja').then(() => undefined))
  }

  /** Signs into the demo account, which owns Luna and holds the found dog. */
  openAsDemoOwner() {
    return step('Open «Bandeja» as the demo owner', async () => {
      await this.open()
      await this.signIn.withGoogle()
    })
  }

  openFromNav() {
    return step('Open «Bandeja» from the bottom bar', () => this.navLink.click())
  }

  item(text: string | RegExp) {
    return this.items.filter({ hasText: text })
  }

  openNotification(text: string | RegExp) {
    return step(`Open the notification «${text}»`, () => this.item(text).getByRole('link').click())
  }
}
