import { expect, test } from '@playwright/test'

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
