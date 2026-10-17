import { expect, type Locator, type Page } from '@playwright/test'
import { PosterPage } from './PosterPage.ts'
import { MapPicker, SignIn, whatsappFrom } from './parts.ts'
import { Signal } from './Signal.ts'
import { step } from './step.ts'

/** `/c/:code`: a case as anyone opening its link sees it — and, for its owner, their side of it. */
export class CasePage {
  readonly page: Page
  readonly signIn: SignIn
  /** The share sheet: poster, WhatsApp, share and download (docs/product/10 §3–4). */
  readonly poster: PosterPage
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
  /** The phone's signal, for «Lo vi» sent from where there is none (frontend.md · Risks §6). */
  readonly signal: Signal
  /** This device's own sightings that have not reached the server: «En espera». */
  readonly queued: Locator
  readonly keptTitle: Locator

  constructor(page: Page) {
    this.page = page
    this.signIn = new SignIn(page)
    this.poster = new PosterPage(page)
    this.map = page.getByTestId('map')
    this.sightings = page
      .getByRole('list', { name: 'Avistamientos', exact: true })
      .getByRole('listitem')
    this.possibleFind = page.getByText('Posible hallazgo.')
    this.possibleOwner = page.getByText('Posible dueño.')
    this.sawIt = page.getByRole('button', { name: /La vi/ })
    this.haveIt = page.getByRole('button', { name: 'La tengo conmigo' })
    this.claimOwnershipButton = page.getByRole('button', { name: /Es mío/ })
    this.whatsapp = page.getByRole('link', { name: 'Escribirle por WhatsApp' })
    this.found = page.getByText('Se encontró', { exact: true })
    this.reunitedButton = page.getByRole('button', { name: 'Ya apareció', exact: true })
    this.backWithOwner = page.getByRole('button', { name: 'Ya está con su dueño' })
    this.unavailable = page.getByRole('heading', { name: 'Este aviso ya no está disponible' })
    // Without a share sheet, «Compartir» downloads the image and copies the message with the link.
    this.linkCopied = this.poster.saved
    this.signal = new Signal(page)
    this.queued = page
      .getByRole('list', { name: 'Tus avistamientos sin enviar' })
      .getByRole('listitem')
    this.keptTitle = page.getByRole('heading', { name: 'Guardamos tu avistamiento' })
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

  /** A browser without a share sheet: sharing falls back to download + copying the message. */
  withoutShareSheet() {
    return step('Use a browser without a share sheet', async () => {
      await this.page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
      await this.page.addInitScript(() => {
        Object.defineProperty(navigator, 'share', { value: undefined })
      })
    })
  }

  share() {
    return step('Share the case', async () => {
      await this.poster.open()
      await this.poster.shareImage()
    })
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

  /** «La vi», filled in up to the send: the spot and a note. */
  startSighting(note: string) {
    return step(`Start a sighting: «${note}»`, async () => {
      await this.sawIt.click()
      await new MapPicker(this.page).mark()
      await expect(this.page.getByText('Punto marcado.')).toBeVisible()
      await this.page.getByLabel(/Nota/).fill(note)
    })
  }

  sendSighting() {
    return step('Send the sighting', () =>
      this.page.getByRole('button', { name: 'Enviar avistamiento' }).click(),
    )
  }

  /** From the form's «Guardamos tu avistamiento» back to the case. */
  backToCase() {
    return step('Go back to the case', () =>
      this.page.getByRole('button', { name: /^Volver al aviso de/ }).click(),
    )
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

  /** The question a check-in asks the owner (docs/product/04 · The follow-up loop). */
  get checkin() {
    return this.page.getByRole('region', { name: 'Pregunta pendiente' })
  }

  answerCheckin(answer: string) {
    return step(`Answer the check-in: «${answer}»`, () =>
      this.checkin.getByRole('button', { name: answer }).click(),
    )
  }

  /** Picks an answer in the open form, e.g. who helped at the reunion. */
  pick(label: string) {
    return step(`Pick «${label}»`, () => this.page.getByLabel(label).check())
  }

  /** A sighting in the timeline, by its note. */
  sighting(note: string) {
    return this.sightings.filter({ hasText: note })
  }

  get hiddenSightings() {
    return this.page.getByRole('list', { name: 'Avistamientos ocultos' }).getByRole('listitem')
  }

  usefulButton(note: string) {
    return this.sighting(note).getByRole('button', { name: 'Marcar como útil' })
  }

  markUseful(note: string) {
    return step(`Mark the sighting «${note}» as useful`, () => this.usefulButton(note).click())
  }

  hideSighting(note: string) {
    return step(`Hide the sighting «${note}» from the map`, () =>
      this.sighting(note).getByRole('button', { name: 'Ocultar del mapa' }).click(),
    )
  }

  unhideSighting(note: string) {
    return step(`Show the sighting «${note}» again`, () =>
      this.hiddenSightings
        .filter({ hasText: note })
        .getByRole('button', { name: 'Volver a mostrar' })
        .click(),
    )
  }

  // --- A pin's sheet (docs/product/04 · Display rules 3) ---

  /** The sheet a sighting pin opens. */
  get pinSheet() {
    return this.page.getByRole('dialog').filter({ has: this.page.getByRole('heading') })
  }

  /** The keyboard's way to a pin: its number in the timeline (GL pins take no focus). */
  openSightingSheet(order: number) {
    return step(`Open sighting ${order}'s sheet from the timeline`, async () => {
      const number = this.page.getByRole('button', {
        name: `Abrir la ficha del avistamiento ${order}`,
      })
      await number.focus()
      await this.page.keyboard.press('Enter')
    })
  }

  closePinSheet() {
    return step('Close the pin sheet with Escape', () => this.page.keyboard.press('Escape'))
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

  /** The day-15 offer's «Publicar en adopción»: a listing on the same pet (05 · 06). */
  listForAdoption() {
    return step('List the animal for adoption from the day-15 offer', () =>
      this.holdOffer.getByRole('link', { name: 'Publicar en adopción' }).click(),
    )
  }
}
