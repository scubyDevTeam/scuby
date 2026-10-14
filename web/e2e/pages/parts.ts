// Pieces several screens share. A page object speaks the user's language — «sign in with an
// email code», «mark the spot» — owns the selectors, and reports each action as one step.
import { expect, type Locator, type Page } from '@playwright/test'
import { step } from './step.ts'

/** The code the emulated backend accepts, by email and by SMS (src/mocks/api/auth.ts). */
export const DEMO_CODE = '123456'

// A 1×1 PNG: enough for the photo pipeline to decode, re-encode and upload.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)

/** The sign-in that appears at the first step needing an account (docs/eng/auth.md). */
export class SignIn {
  readonly page: Page
  readonly title: Locator

  constructor(page: Page) {
    this.page = page
    this.title = page.getByRole('heading', { name: 'Entra para continuar' })
  }

  withEmailCode(email: string, code = DEMO_CODE) {
    return step(`Sign in as ${email} with the emailed code`, async () => {
      await this.page.getByLabel('Correo electrónico').fill(email)
      await this.page.getByRole('button', { name: 'Enviarme un código' }).click()
      await this.page.getByLabel(/Código de 6 dígitos/).fill(code)
    })
  }

  /** In the emulation, Google signs into the demo account: it owns Luna and holds a found dog. */
  withGoogle() {
    return step('Sign in with Google', async () => {
      await this.page.getByRole('button', { name: 'Continuar con Google' }).click()
    })
  }
}

/** The map a form marks a point or an area on. */
export class MapPicker {
  readonly map: Locator

  constructor(page: Page) {
    this.map = page.getByTestId('picker-map')
  }

  /** Taps the middle of the map once it can take a tap. */
  mark() {
    return step('Mark the spot on the map', async () => {
      await expect(this.map).toHaveAttribute('data-map-ready', 'true')
      await this.map.click()
    })
  }
}

export class PhotoPicker {
  readonly page: Page

  constructor(page: Page) {
    this.page = page
  }

  /** Adds one photo and waits for its preview: the upload has gone through the pipeline. */
  add(name = 'foto.png') {
    return step(`Add the photo ${name}`, async () => {
      const before = await this.page.getByRole('img', { name: /^Foto \d+$/ }).count()
      await this.page
        .getByLabel(/Agregar foto/)
        .setInputFiles({ name, mimeType: 'image/png', buffer: PNG })
      await expect(this.page.getByRole('img', { name: `Foto ${before + 1}` })).toBeVisible()
    })
  }
}

/** The phone step every publish ends with (docs/eng/auth.md · UI contract). */
export class PhoneStep {
  readonly page: Page

  constructor(page: Page) {
    this.page = page
  }

  /** `submit` is the form's own button: lost and found «avisan a los vecinos», adoption doesn't. */
  publishVerifying(phone: string, code = DEMO_CODE, submit = 'Publicar y avisar a los vecinos') {
    return step(`Publish, verifying ${phone} by SMS`, async () => {
      await this.page.getByLabel('Tu celular').fill(phone)
      await this.page.getByRole('button', { name: submit }).click()
      await this.page.getByLabel('Código que te enviamos por SMS').fill(code)
    })
  }
}

/** The close of every publish flow. */
export class Published {
  readonly page: Page
  readonly title: Locator

  constructor(page: Page) {
    this.page = page
    this.title = page.getByRole('heading', { name: '¡Aviso publicado!' })
  }

  openCase() {
    return step('Open the published case', async () => {
      await expect(this.title).toBeVisible()
      await this.page.getByRole('link', { name: 'Ver mi aviso' }).click()
    })
  }

  openListing() {
    return step('Open the published listing', async () => {
      await expect(
        this.page.getByRole('heading', { name: '¡Publicado en adopción!' }),
      ).toBeVisible()
      await this.page.getByRole('link', { name: 'Ver la publicación' }).click()
    })
  }
}

/** Buttons that hand off to WhatsApp open it in a popup; the URL is all a test can check. */
export async function whatsappFrom(page: Page, click: () => Promise<void>): Promise<string> {
  const popup = page.waitForEvent('popup')
  await click()
  return (await popup).url()
}
