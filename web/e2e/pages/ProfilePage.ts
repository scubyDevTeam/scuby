import type { Locator, Page } from '@playwright/test'
import { SignIn } from './parts.ts'
import { step } from './step.ts'

/** `/perfil`: the account (docs/eng/auth.md · Profile). */
export class ProfilePage {
  readonly page: Page
  readonly signIn: SignIn

  constructor(page: Page) {
    this.page = page
    this.signIn = new SignIn(page)
  }

  open() {
    return step('Open the profile', () => this.page.goto('/perfil').then(() => undefined))
  }

  reload() {
    return step('Reload the page', () => this.page.reload().then(() => undefined))
  }

  name(displayName: string): Locator {
    return this.page.getByRole('heading', { name: displayName })
  }

  email(address: string): Locator {
    return this.page.getByText(address)
  }

  signOut() {
    return step('Sign out', () => this.page.getByRole('button', { name: 'Cerrar sesión' }).click())
  }
}
