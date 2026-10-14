import { expect, test } from './test.ts'

test('browse the feed, filter it, and open a case', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'Cerca de ti, ahora' })).toBeVisible()
  const cards = page.getByRole('listitem').filter({ has: page.getByRole('article') })
  await expect(cards).toHaveCount(5)

  await page.getByRole('button', { name: 'Perdidos' }).click()
  await expect(cards).toHaveCount(2)
  await expect(cards.filter({ hasText: 'Se busca' })).toHaveCount(2)

  await page.getByRole('button', { name: 'Gatos' }).click()
  await expect(cards).toHaveCount(1)
  await cards.getByRole('link').click()

  await expect(page).toHaveURL(/\/c\/M2TQ4$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Milo' })).toBeVisible()
})

test('on a desktop the feed and its map sit side by side', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/')

  await expect(page.getByRole('navigation', { name: 'Principal' })).toBeHidden()
  await expect(page.getByRole('link', { name: 'Publicar aviso' })).toBeVisible()
  await expect(page.getByRole('article')).toHaveCount(5)
  await expect(page.getByTestId('feed-map')).toHaveAttribute('data-map-ready', 'true')
})

test('on a phone the map replaces the list', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('article')).toHaveCount(5)

  await page.getByRole('button', { name: 'Mapa' }).click()

  await expect(page.getByTestId('feed-map')).toHaveAttribute('data-map-ready', 'true')
  await expect(page.getByRole('article')).toHaveCount(0)
})
