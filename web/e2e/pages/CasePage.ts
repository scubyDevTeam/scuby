import { expect, type Locator, type Page } from '@playwright/test'
import { MapPicker, SignIn, whatsappFrom } from './parts.ts'
import { step } from './step.ts'

/** `/c/:code`: a case as anyone opening its link sees it — and, for its owner, their side of it. */
export class CasePage {
  readonly page: Page
  readonly signIn: SignIn
  readonly map: Locator
  readonly sightings: Locator
  readonly possibleFind: Locator
  readonly possibleOwner: Locator
  readonly sawIt: Locator
  readonly haveIt: Locator
  readonly claimOwnershipButton: Locator
  readonly whatsapp: Locator
  readonly found: Locator
  readonly reunitedButton: Locator
  readonly backWithOwner: Locator
  readonly unavailable: Locator
  readonly linkCopied: Locator

  constructor(page: Page) {
    this.page = page
    this.signIn = new SignIn(page)
    this.map = page.getByTestId('map')
    this.sightings = page.getByRole('list', { name: 'Avistamientos' }).getByRole('listitem')
    this.possibleFind = page.getByText('Posible hallazgo.')
    this.possibleOwner = page.getByText('Posible dueño.')
    this.sawIt = page.getByRole('button', { name: /La vi/ })
    this.haveIt = page.getByRole('button', { name: 'La tengo conmigo' })
    this.claimOwnershipButton = page.getByRole('button', { name: /Es mío/ })
    this.whatsapp = page.getByRole('link', { name: 'Escribirle por WhatsApp' })
    this.found = page.getByText('Se encontró', { exact: true })
    this.reunitedButton = page.getByRole('button', { name: 'Ya apareció' })
    this.backWithOwner = page.getByRole('button', { name: 'Ya está con su dueño' })
    this.unavailable = page.getByRole('heading', { name: 'Este aviso ya no está disponible' })
    this.linkCopied = page.getByRole('heading', { name: 'Enlace copiado' })
  }

  open(code: string) {
    return step(`Open the case ${code} from its link`, () =>
      this.page.goto(`/c/${code}`).then(() => undefined),
    )
  }

  title(name: string) {
    return this.page.getByRole('heading', { level: 1, name })
  }

  text(content: string) {
    return this.page.getByText(content)
  }

  /** A choice in a form, e.g. the attribution the close suggests. */
  choice(label: string) {
    return this.page.getByLabel(label)
  }

  // --- What anyone does with a link (docs/product/10) ---

  goToOtherCases() {
    return step('Go to the other cases', () =>
      this.page.getByRole('link', { name: 'Ver otros avisos' }).click(),
    )
  }

  /** A browser without a share sheet: sharing falls back to copying the link. */
  withoutShareSheet() {
    return step('Use a browser without a share sheet', async () => {
      await this.page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
      await this.page.addInitScript(() => {
        Object.defineProperty(navigator, 'share', { value: undefined })
      })
    })
  }

  share() {
    return step('Share the case', () =>
      this.page.getByRole('button', { name: 'Compartir aviso' }).click(),
    )
  }

  copiedText() {
    return this.page.evaluate(() => navigator.clipboard.readText())
  }

  // --- What a helper does without an account (docs/product/04, 09) ---

  reportSighting(note: string) {
    return step(`Report a sighting: «${note}»`, async () => {
      await this.sawIt.click()
      await new MapPicker(this.page).mark()
      await expect(this.page.getByText('Punto marcado.')).toBeVisible()
      await this.page.getByLabel(/Nota/).fill(note)
      await this.page.getByRole('button', { name: 'Enviar avistamiento' }).click()
      await expect(this.page.getByText('¡Gracias!')).toBeVisible()
      await this.page.getByRole('button', { name: 'Listo' }).click()
    })
  }

  /** «La tengo conmigo»: answers the WhatsApp URL the claim opened. */
  claimRecovery(phone: string): Promise<string> {
    return step(`Say «la tengo conmigo», leaving ${phone}`, async () => {
      await this.haveIt.click()
      await this.page.getByLabel('Tu celular').fill(phone)
      const url = await whatsappFrom(this.page, () =>
        this.page.getByRole('button', { name: /Avisar y abrir WhatsApp/ }).click(),
      )
      await expect(this.page.getByText('Ya le avisamos a su familia.')).toBeVisible()
      await this.page.getByRole('button', { name: 'Listo' }).click()
      return url
    })
  }

  startReport(reason: string) {
    return step(`Start a report: «${reason}»`, async () => {
      await this.page.getByRole('button', { name: 'Reportar' }).click()
      await this.page.getByLabel(reason).check()
    })
  }

  sendReport() {
    return step('Send the report', () =>
      this.page.getByRole('button', { name: 'Enviar reporte' }).click(),
    )
  }

  // --- «Es mío» on a found case (docs/product/05) ---

  claimOwnership() {
    return step('Say «es mío»', () => this.claimOwnershipButton.click())
  }

  /** Fills the evidence and sends it; answers the WhatsApp URL. Sign-in comes before, if needed. */
  sendOwnershipClaim(evidence: string): Promise<string> {
    return step(`Send the proof: «${evidence}»`, async () => {
      await this.page.getByLabel(/Describe algo/).fill(evidence)
      const url = await whatsappFrom(this.page, () =>
        this.page.getByRole('button', { name: 'Avisar que es mío' }).click(),
      )
      await expect(this.page.getByText('Le avisamos a quien lo cuida.')).toBeVisible()
      await this.page.getByRole('button', { name: 'Listo' }).click()
      return url
    })
  }

  // --- The owner of a lost case (docs/product/04) ---

  get claims() {
    return this.page.getByRole('region', { name: 'Posibles hallazgos' })
  }

  confirmClaim(petName: string) {
    return step(`Confirm the claim: it is ${petName}`, () =>
      this.claims.getByRole('button', { name: `Sí, es ${petName}` }).click(),
    )
  }

  closeAsReunited(petName: string) {
    return step(`Close the case: ${petName} is home`, () =>
      this.page.getByRole('button', { name: `Sí, ${petName} ya está en casa` }).click(),
    )
  }

  deleteAs(reason: string) {
    return step(`Delete the case: «${reason}»`, async () => {
      await this.page.getByRole('button', { name: 'Eliminar aviso' }).click()
      await this.page.getByLabel(reason).check()
      await this.page.getByRole('dialog').getByRole('button', { name: 'Eliminar aviso' }).click()
    })
  }

  // --- The custodian of a found case (docs/product/05) ---

  get ownershipClaims() {
    return this.page.getByRole('region', { name: 'Posibles dueños' })
  }

  get holdOffer() {
    return this.page.getByRole('region', { name: 'Quince días sin dueño' })
  }

  confirmOwner() {
    return step('Confirm the claimant is the owner', () =>
      this.ownershipClaims.getByRole('button', { name: 'Sí, es el dueño' }).click(),
    )
  }

  handOver() {
    return step('Hand the animal over to its owner', () =>
      this.page.getByRole('button', { name: 'Sí, ya está con su dueño' }).click(),
    )
  }

  keepIt() {
    return step('Keep the animal', async () => {
      await this.holdOffer.getByRole('button', { name: 'Me lo quedo' }).click()
      await this.page.getByRole('dialog').getByRole('button', { name: 'Me lo quedo' }).click()
    })
  }
}
