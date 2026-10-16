import { expect, tags, test } from './test.ts'

test(
  'browse the feed, filter it, and open a case',
  tags('@feed', '@FEED-001'),
  async ({ feed, casePage, page }) => {
    await test.step('every open case near Medellín is listed', async () => {
      await feed.open()
      await expect(feed.title).toBeVisible()
      // Lost, found, adoption — open and «en proceso» — and help: everything still open.
      await expect(feed.cards).toHaveCount(9)
    })

    await test.step('filtering narrows it to lost cats', async () => {
      await feed.filter('Perdidos')
      await expect(feed.cards).toHaveCount(2)
      await expect(feed.cardsSaying('Se busca')).toHaveCount(2)
      await feed.filter('Gatos')
      await expect(feed.cards).toHaveCount(1)
    })

    await test.step('the card opens its case', async () => {
      await feed.openOnlyCard()
      await expect(page).toHaveURL(/\/c\/M2TQ4$/)
      await expect(casePage.title('Milo')).toBeVisible()
    })
  },
)

test(
  'on a desktop the feed and its map sit side by side',
  tags('@feed', '@FEED-002'),
  async ({ feed }) => {
    await test.step('open the feed on a desktop', async () => {
      await feed.onDesktop()
      await feed.open()
    })

    await test.step('list and map show together, with the desktop chrome', async () => {
      await expect(feed.mainNavigation).toBeHidden()
      await expect(feed.publishLink).toBeVisible()
      await expect(feed.articles).toHaveCount(9)
      await expect(feed.map).toHaveAttribute('data-map-ready', 'true')
    })
  },
)

test('on a phone the map replaces the list', tags('@feed', '@FEED-003'), async ({ feed }) => {
  await test.step('the phone shows the list first', async () => {
    await feed.open()
    await expect(feed.articles).toHaveCount(9)
  })

  await test.step('the map takes the list’s place', async () => {
    await feed.showMap()
    await expect(feed.map).toHaveAttribute('data-map-ready', 'true')
    await expect(feed.articles).toHaveCount(0)
  })
})
