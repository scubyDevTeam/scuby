import type { Locator, Page } from '@playwright/test'
import { SignIn } from './parts.ts'
import { step } from './step.ts'

type Journey = 'Mascotas perdidas' | 'Mascotas encontradas' | 'Adopción' | 'Pedidos de ayuda'

/** `/perfil`: the account (docs/eng/auth.md · Profile). */
export class ProfilePage {
  readonly page: Page
  readonly signIn: SignIn
  readonly nameField: Locator
  readonly cityField: Locator
  readonly bioField: Locator
  readonly saved: Locator

  constructor(page: Page) {
    this.page = page
    this.signIn = new SignIn(page)
    this.nameField = page.getByLabel('Tu nombre')
    this.cityField = page.getByLabel(/^Ciudad/)
    this.bioField = page.getByLabel(/^Sobre ti/)
    this.saved = page.getByText('Guardamos tus cambios.')
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

  notification(journey: Journey): Locator {
    return this.page.getByRole('switch', { name: journey })
  }

  editName(displayName: string) {
    return step(`Change the name to «${displayName}»`, () => this.nameField.fill(displayName))
  }

  editCity(city: string) {
    return step(`Change the city to «${city}»`, () => this.cityField.fill(city))
  }

  editBio(bio: string) {
    return step('Write the bio', () => this.bioField.fill(bio))
  }

  toggleNotification(journey: Journey) {
    return step(`Toggle the notifications about «${journey}»`, () =>
      this.notification(journey).click(),
    )
  }

  save() {
    return step('Save the changes', () =>
      this.page.getByRole('button', { name: 'Guardar cambios' }).click(),
    )
  }

  signOut() {
    return step('Sign out', () => this.page.getByRole('button', { name: 'Cerrar sesión' }).click())
  }
}
