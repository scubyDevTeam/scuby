import { expect, type Locator, type Page } from '@playwright/test'
import { DEMO_CODE, SignIn, whatsappFrom } from './parts.ts'
import { step } from './step.ts'

type Intro = { housing: 'Casa' | 'Apartamento'; yard: 'Sí' | 'No'; why: string }

/** `/c/:code` for an adoption listing (docs/product/06): «Me interesa», and the lister's side. */
export class AdoptionPage {
  readonly page: Page
  readonly signIn: SignIn
  readonly sheet: Locator
  readonly interestedNote: Locator
  readonly adopterSafety: Locator
  readonly interests: Locator
  readonly noInterestsYet: Locator

  constructor(page: Page) {
    this.page = page
    this.signIn = new SignIn(page)
    this.sheet = page.getByRole('dialog')
    this.interestedNote = page.getByText('Ya te anotaste.')
    this.adopterSafety = this.sheet.getByText(/Nunca pagues nada antes de conocerlo/)
    this.interests = page.getByRole('region', { name: 'Personas interesadas' })
    this.noInterestsYet = page.getByText('Todavía nadie dijo «Me interesa».')
  }

  open(code: string) {
    return step(`Open the listing ${code} from its link`, () =>
      this.page.goto(`/c/${code}`).then(() => undefined),
    )
  }

  title(name: string) {
    return this.page.getByRole('heading', { level: 1, name })
  }

  text(content: string | RegExp) {
    return this.page.getByText(content)
  }

  sayInterested() {
    return step('Say «Me interesa»', () =>
      this.page.getByRole('button', { name: /Me interesa/ }).click(),
    )
  }

  /** The four fields and the why (06 · adoption_interest). */
  introduce(intro: Intro) {
    return step(`Introduce yourself: ${intro.housing}, patio ${intro.yard}`, async () => {
      await this.sheet.getByRole('button', { name: intro.housing, exact: true }).click()
      await this.sheet.getByRole('button', { name: intro.yard, exact: true }).click()
      await this.sheet.getByLabel(/^¿Por qué /).fill(intro.why)
    })
  }

  /** Sends the intro, verifying the number by SMS on the way; answers the WhatsApp URL it opens. */
  sendVerifying(phone: string, code = DEMO_CODE): Promise<string> {
    return step(`Send the introduction, verifying ${phone} by SMS`, async () => {
      await this.sheet.getByLabel('Tu celular').fill(phone)
      await this.sheet.getByRole('button', { name: 'Enviar y escribirle' }).click()
      return whatsappFrom(this.page, () =>
        this.sheet.getByLabel('Código que te enviamos por SMS').fill(code),
      )
    })
  }

  done() {
    return step('Close the sheet', () => this.sheet.getByRole('button', { name: 'Listo' }).click())
  }

  // --- The lister (06 · What the lister sees) ---

  person(name: string) {
    return this.interests.getByRole('listitem', { name })
  }

  choose(name: string) {
    return step(`Choose ${name}`, () =>
      this.person(name).getByRole('button', { name: 'Elegir' }).click(),
    )
  }

  /** «Ya fue adoptado» → «¿Quién lo adoptó?» → that person. */
  recordAdoptionBy(name: string) {
    return step(`Record the adoption by ${name}`, async () => {
      await this.page.getByRole('button', { name: 'Ya fue adoptado 🎉' }).first().click()
      await this.sheet.getByLabel(name).check()
      await this.sheet.getByRole('button', { name: 'Confirmar adopción' }).click()
      await expect(this.sheet).toHaveCount(0)
    })
  }
}
