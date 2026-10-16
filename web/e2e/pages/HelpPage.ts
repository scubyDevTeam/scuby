import { expect, type Locator, type Page } from '@playwright/test'
import { DEMO_CODE, SignIn, whatsappFrom } from './parts.ts'
import { step } from './step.ts'

type NeedName = 'Hogar temporal' | 'Transporte' | 'Insumos'

/** `/c/:code` for a help request (docs/product/07): «Yo ayudo», and the beneficiary's side. */
export class HelpPage {
  readonly page: Page
  readonly signIn: SignIn
  readonly sheet: Locator
  readonly needs: Locator
  readonly offers: Locator
  readonly safety: Locator

  constructor(page: Page) {
    this.page = page
    this.signIn = new SignIn(page)
    this.sheet = page.getByRole('dialog')
    this.needs = page.getByRole('list', { name: 'Lo que necesita' })
    this.offers = page.getByRole('region', { name: 'Quienes ofrecieron ayuda' })
    this.safety = this.sheet.getByText(/encuéntrense en un lugar público/)
  }

  open(code: string) {
    return step(`Open the help request ${code} from its link`, () =>
      this.page.goto(`/c/${code}`).then(() => undefined),
    )
  }

  title(name: string) {
    return this.page.getByRole('heading', { level: 1, name })
  }

  text(content: string | RegExp) {
    return this.page.getByText(content)
  }

  need(name: NeedName) {
    return this.needs.getByRole('listitem', { name })
  }

  offerOn(name: NeedName) {
    return step(`Say «Yo ayudo» on ${name}`, () =>
      this.need(name).getByRole('button', { name: 'Yo ayudo con esto' }).click(),
    )
  }

  /** The note, then the number verified by SMS; answers the WhatsApp URL the offer opens. */
  offerVerifying(note: string, phone: string, code = DEMO_CODE): Promise<string> {
    return step(`Offer «${note}», verifying ${phone} by SMS`, async () => {
      await this.sheet.getByLabel(/^Un mensaje para /).fill(note)
      await this.sheet.getByLabel('Tu celular').fill(phone)
      await this.sheet.getByRole('button', { name: 'Ofrecer y escribirle' }).click()
      return whatsappFrom(this.page, () =>
        this.sheet.getByLabel('Código que te enviamos por SMS').fill(code),
      )
    })
  }

  done() {
    return step('Close the sheet', () => this.sheet.getByRole('button', { name: 'Listo' }).click())
  }

  // --- The beneficiary (07 · only the beneficiary confirms) ---

  offer(person: string) {
    return this.offers.getByRole('listitem', { name: person })
  }

  confirmArrived(person: string) {
    return step(`Confirm that ${person}'s help arrived`, () =>
      this.offer(person).getByRole('button', { name: 'Llegó', exact: true }).click(),
    )
  }

  /** «Ya tengo lo que necesitaba» on the need's group of offers. */
  coverAll() {
    return step('Mark every remaining need covered', async () => {
      const buttons = this.offers.getByRole('button', { name: 'Ya tengo lo que necesitaba' })
      while ((await buttons.count()) > 0) {
        const before = await buttons.count()
        await buttons.first().click()
        await expect(buttons).toHaveCount(before - 1)
      }
    })
  }
}
