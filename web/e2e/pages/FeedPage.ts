import { expect, type Locator, type Page } from '@playwright/test'
import { step } from './step.ts'

/** What the feed map has on screen, as it writes it on `data-pins` once it settles. */
export type MapPinOnScreen = { id?: string; count?: number; tone: string; x: number; y: number }

/** `/`: open cases near the viewer, as a list or a map (docs/product/00 · Geography). */
export class FeedPage {
  readonly page: Page
  readonly title: Locator
  readonly cards: Locator
  readonly articles: Locator
  readonly map: Locator
  readonly mainNavigation: Locator
  readonly publishLink: Locator
  /** The card a tapped pin opens over the map. */
  readonly pinCard: Locator
  readonly pinCardTitle: Locator

  constructor(page: Page) {
    this.page = page
    this.title = page.getByRole('heading', { name: 'Cerca de ti, ahora' })
    this.cards = page.getByRole('listitem').filter({ has: page.getByRole('article') })
    this.articles = page.getByRole('article')
    this.map = page.getByTestId('feed-map')
    this.mainNavigation = page.getByRole('navigation', { name: 'Principal' })
    this.publishLink = page.getByRole('link', { name: 'Publicar aviso' })
    this.pinCard = this.map.locator('..').getByRole('dialog')
    this.pinCardTitle = this.pinCard.getByRole('heading')
  }

  open() {
    return step('Open the feed', () => this.page.goto('/').then(() => undefined))
  }

  /** «Perdidos», «Gatos», …: the filter chips. */
  filter(name: string) {
    return step(`Filter the feed by «${name}»`, () =>
      this.page.getByRole('button', { name }).click(),
    )
  }

  showMap() {
    return step('Switch the feed to its map', () =>
      this.page.getByRole('button', { name: 'Mapa' }).click(),
    )
  }

  /**
   * Desktop width: the layout where list and map sit side by side. A short window shows the same
   * cases on a smaller map, where they crowd.
   */
  onDesktop(height = 900) {
    return step(`Use a desktop-sized window, ${height} px tall`, () =>
      this.page.setViewportSize({ width: 1280, height }),
    )
  }

  cardsSaying(text: string) {
    return this.cards.filter({ hasText: text })
  }

  openOnlyCard() {
    return step('Open the only card left', () => this.cards.getByRole('link').click())
  }

  // --- The map's pins: GL layers, so a tap is a position on the canvas ---

  /** Groups and single cases on screen, once the map has settled. */
  async pinsOnScreen(): Promise<MapPinOnScreen[]> {
    await expect(this.map).toHaveAttribute('data-pins', /\[/)
    return JSON.parse((await this.map.getAttribute('data-pins')) ?? '[]')
  }

  /** Taps the biggest group: the map zooms into it. */
  tapBiggestGroup() {
    return step('Tap the biggest group of pins', async () => {
      const groups = (await this.pinsOnScreen()).filter((pin) => pin.count)
      const biggest = groups.sort((a, b) => (b.count ?? 0) - (a.count ?? 0))[0]
      if (!biggest) throw new Error('No group of pins on the map')
      const before = await this.map.getAttribute('data-pins')
      await this.map.click({ position: { x: biggest.x, y: biggest.y } })
      // The zoom has landed when the map has settled on something else.
      await expect(this.map).not.toHaveAttribute('data-pins', before ?? '')
    })
  }

  /** Taps the pin of one case, by its code. */
  tapCasePin(code: string) {
    return step(`Tap the pin of case ${code}`, async () => {
      const pin = (await this.pinsOnScreen()).find((p) => p.id === code)
      if (!pin) throw new Error(`No pin for ${code} on the map`)
      await this.map.click({ position: { x: pin.x, y: pin.y } })
    })
  }

  openCaseFromPinCard() {
    return step('Open the case from its pin card', () =>
      this.pinCard.getByRole('link', { name: 'Ver' }).click(),
    )
  }
}
