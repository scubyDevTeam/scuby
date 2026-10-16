import type { Locator, Page } from '@playwright/test'
import { MapPicker, PhoneStep, PhotoPicker, Published, SignIn, whatsappFrom } from './parts.ts'
import { step } from './step.ts'

type Look = { species: string; size?: string; colour?: string }

/** `/publicar`: the four doors, and the lost and found forms behind two of them. */
export class PublishPage {
  readonly page: Page
  readonly signIn: SignIn
  readonly photos: PhotoPicker
  readonly map: MapPicker
  readonly phone: PhoneStep
  readonly published: Published
  readonly candidates: Locator
  readonly thanks: Locator
  readonly familyTold: Locator

  constructor(page: Page) {
    this.page = page
    this.signIn = new SignIn(page)
    this.photos = new PhotoPicker(page)
    this.map = new MapPicker(page)
    this.phone = new PhoneStep(page)
    this.published = new Published(page)
    this.candidates = page.getByRole('heading', { name: '¿Es alguno de estos?' })
    this.thanks = page.getByRole('heading', { name: '¡Gracias por avisar!' })
    this.familyTold = page.getByText('Ya le avisamos a su familia.')
  }

  open() {
    return step('Open «Publicar»', () => this.page.goto('/publicar').then(() => undefined))
  }

  openFound() {
    return step('Open «Encontré un animal»', () =>
      this.page.goto('/publicar/encontrado').then(() => undefined),
    )
  }

  chooseLost() {
    return step('Choose «Perdí a mi mascota»', () =>
      this.page.getByRole('link', { name: /Perdí a mi mascota/ }).click(),
    )
  }

  chooseAdoption() {
    return step('Choose «Dar en adopción»', () =>
      this.page.getByRole('link', { name: /Dar en adopción/ }).click(),
    )
  }

  chooseHelp() {
    return step('Choose «Pedir ayuda»', () =>
      this.page.getByRole('link', { name: /Pedir ayuda/ }).click(),
    )
  }

  // --- Help (docs/product/07 · Publishing) ---

  /** Step 1: one of the account's pets. */
  helpFor(pet: string) {
    return step(`Ask for help for ${pet}`, () =>
      this.page.getByRole('button', { name: pet, exact: true }).click(),
    )
  }

  /** Step 2: one need, saying exactly what. */
  ask(kind: 'Hogar temporal' | 'Transporte' | 'Insumos', detail: string) {
    return step(`Ask for ${kind}: «${detail}»`, async () => {
      await this.page.getByRole('button', { name: `Agregar ${kind}` }).click()
      await this.page.getByRole('region', { name: kind }).getByRole('textbox').first().fill(detail)
    })
  }

  tellNeighbours(story: string) {
    return step('Tell the neighbours what happened', () =>
      this.page.getByLabel(/Cuéntales a tus vecinos/).fill(story),
    )
  }

  // --- Adoption (docs/product/06 · adoption_case) ---

  /** Step 1's own questions: what the animal is called and who it is to the lister. */
  nameListing(name: string, role?: 'Es mi mascota' | 'Lo rescaté o lo cuido') {
    return step(`Name the animal ${name}${role ? `, «${role}»` : ''}`, async () => {
      await this.page.getByLabel('¿Cómo se llama?').fill(name)
      if (role) await this.page.getByRole('button', { name: role }).click()
    })
  }

  /** Step 2: the story. */
  tellStory(story: string) {
    return step('Tell their story', async () => {
      const field = this.page.getByLabel(/Cuéntanos su historia/)
      if (story) await field.fill(story)
      await this.next()
    })
  }

  chooseFound() {
    return step('Choose «Encontré un animal»', () =>
      this.page.getByRole('link', { name: /Encontré un animal/ }).click(),
    )
  }

  /** «¿Lo tienes contigo?» — the question that routes to a found case or to a witness report. */
  iHaveIt() {
    return step('Answer «sí, lo tengo conmigo»', () =>
      this.page.getByRole('link', { name: 'Sí, lo tengo conmigo' }).click(),
    )
  }

  iOnlySawIt() {
    return step('Answer «no, solo lo vi»', () =>
      this.page.getByRole('link', { name: 'No, solo lo vi' }).click(),
    )
  }

  describe(look: Look) {
    const words = [look.species, look.size, look.colour].filter(Boolean).join(', ')
    return step(`Describe the animal: ${words}`, async () => {
      await this.page.getByRole('button', { name: look.species }).click()
      if (look.size) await this.page.getByRole('button', { name: look.size }).click()
      if (look.colour) await this.page.getByRole('button', { name: look.colour }).click()
    })
  }

  name(name: string) {
    return step(`Name the pet ${name}`, () => this.page.getByLabel('Nombre').fill(name))
  }

  withhold(detail: string) {
    return step(`Keep a detail to check owners against: «${detail}»`, () =>
      this.page.getByLabel(/Guarda un dato/).fill(detail),
    )
  }

  next() {
    return step('Continue', () => this.page.getByRole('button', { name: 'Continuar' }).click())
  }

  /** «Hoy», «Ayer», …: when it happened, then on to the next step. */
  when(label: string) {
    return step(`Say when: «${label}»`, async () => {
      await this.page.getByRole('button', { name: label }).click()
      await this.next()
    })
  }

  // --- Found: matching comes first (docs/product/05 · Publishing) ---

  itIs(name: string) {
    return step(`Recognise the animal as ${name}`, () =>
      this.page.getByRole('button', { name: `Sí, es ${name}` }).click(),
    )
  }

  /** The animal is someone's lost pet: tell its family, and answer the WhatsApp URL. */
  tellTheFamily(phone: string): Promise<string> {
    return step(`Tell the family, leaving ${phone}`, async () => {
      await this.page.getByLabel('Tu celular').fill(phone)
      return whatsappFrom(this.page, () =>
        this.page.getByRole('button', { name: /Avisar y abrir WhatsApp/ }).click(),
      )
    })
  }

  /** A witness report: no account, just the pin. */
  sendWitnessReport() {
    return step('Send the witness report', () =>
      this.page.getByRole('button', { name: 'Enviar reporte' }).click(),
    )
  }
}
