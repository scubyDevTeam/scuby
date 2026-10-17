import type { Locator, Page } from '@playwright/test'
import { expect } from '@playwright/test'
import { MapPicker, SignIn } from './parts.ts'
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

  /** «Mascotas perdidas cerca de mí»: the profile's switch for the zone (08). */
  get alertsOn() {
    return this.page.getByText(/Te avisamos de mascotas perdidas cerca de .+, unos \d km alrededor/)
  }

  activateAlerts(radiusKm: 1 | 2 | 5) {
    return step(`Turn on nearby alerts, ${radiusKm} km around`, async () => {
      await this.page.getByRole('button', { name: 'Activar alertas' }).click()
      // The browser's permission is the first step; the zone is what is under test, so «Ahora no».
      await this.page.getByRole('button', { name: 'Ahora no' }).click()
      await new MapPicker(this.page).mark()
      await this.page.getByRole('button', { name: `${radiusKm} km`, exact: true }).click()
      await this.page.getByRole('button', { name: 'Listo, avísame' }).click()
      await expect(this.page.getByText('Listo, te avisaremos.')).toBeVisible()
      await this.page.getByRole('button', { name: 'Listo', exact: true }).click()
    })
  }

  turnOffAlerts() {
    return step('Turn off nearby alerts', () =>
      this.page.getByRole('button', { name: 'Apagar alertas' }).click(),
    )
  }

  get alertsOffer() {
    return this.page.getByRole('button', { name: 'Activar alertas' })
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
