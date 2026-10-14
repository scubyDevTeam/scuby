import type { Locator, Page } from '@playwright/test'
import { step } from './step.ts'

/** `/`: open cases near the viewer, as a list or a map (docs/product/00 · Geography). */
export class FeedPage {
  readonly page: Page
  readonly title: Locator
  readonly cards: Locator
  readonly articles: Locator
  readonly map: Locator
  readonly mainNavigation: Locator
  readonly publishLink: Locator

  constructor(page: Page) {
    this.page = page
    this.title = page.getByRole('heading', { name: 'Cerca de ti, ahora' })
    this.cards = page.getByRole('listitem').filter({ has: page.getByRole('article') })
    this.articles = page.getByRole('article')
    this.map = page.getByTestId('feed-map')
    this.mainNavigation = page.getByRole('navigation', { name: 'Principal' })
    this.publishLink = page.getByRole('link', { name: 'Publicar aviso' })
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

  /** Desktop width: the layout where list and map sit side by side. */
  onDesktop() {
    return step('Use a desktop-sized window', () =>
      this.page.setViewportSize({ width: 1280, height: 900 }),
    )
  }

  cardsSaying(text: string) {
    return this.cards.filter({ hasText: text })
  }

  openOnlyCard() {
    return step('Open the only card left', () => this.cards.getByRole('link').click())
  }
}
