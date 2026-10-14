import { expect, test } from '@playwright/test'

test('a shared link to an active lost case shows who, where and what to do', async ({ page }) => {
  await page.goto('/c/7K3PQ')

  await expect(page.getByRole('heading', { level: 1, name: 'Luna' })).toBeVisible()
  await expect(page.getByText('Se busca')).toBeVisible()
  await expect(page.getByRole('button', { name: /La vi/ })).toBeVisible()
  await expect(page.getByRole('button', { name: 'La tengo conmigo' })).toBeVisible()
  await expect(page.getByText('Posible hallazgo.')).toBeVisible()

  // The trajectory, newest first.
  const sightings = page.getByRole('list').getByRole('listitem')
  await expect(sightings).toHaveCount(3)
  await expect(sightings.first()).toContainText('hace 2 h')

  await expect(page.getByRole('link', { name: 'Escribirle por WhatsApp' })).toHaveAttribute(
    'href',
    /^https:\/\/wa\.me\//,
  )
})

test('the same link shows the reunion once the case is closed, with nothing left to do', async ({
  page,
}) => {
  await page.goto('/c/H4PPY')

  await expect(page.getByText('¡Toby ya está en casa!')).toBeVisible()
  await expect(page.getByRole('button', { name: /La vi/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'La tengo conmigo' })).toHaveCount(0)
})

test('a purged code still resolves, so a printed poster never 404s', async ({ page }) => {
  await page.goto('/c/GONE5')

  await expect(
    page.getByRole('heading', { name: 'Este aviso ya no está disponible' }),
  ).toBeVisible()
  await page.getByRole('link', { name: 'Ver otros avisos' }).click()
  await expect(page).toHaveURL(/\/$/)
})

test('sharing a case copies its link when the device has no share sheet', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'share', { value: undefined })
  })
  await page.goto('/c/7K3PQ')

  await page.getByRole('button', { name: 'Compartir aviso' }).click()

  await expect(page.getByRole('heading', { name: 'Enlace copiado' })).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/c\/7K3PQ$/)
})
