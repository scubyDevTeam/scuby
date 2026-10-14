import { expect, test } from './test.ts'

test('the owner answers a claim and closes the case as reunited', async ({ page }) => {
  // The demo Google account owns Luna.
  await page.goto('/mis-casos')
  await page.getByRole('button', { name: 'Continuar con Google' }).click()
  await page.getByRole('heading', { name: 'Luna' }).click()

  const claims = page.getByRole('region', { name: 'Posibles hallazgos' })
  await expect(claims.getByRole('link', { name: 'Abrir WhatsApp' })).toHaveAttribute(
    'href',
    'https://wa.me/573114829017',
  )
  await claims.getByRole('button', { name: 'Sí, es Luna' }).click()

  // Confirming the claim leads to the close, with the answer already suggested.
  await expect(page.getByLabel('Alguien la tenía y avisó aquí')).toBeChecked()
  await page.getByRole('button', { name: 'Sí, Luna ya está en casa' }).click()

  await expect(page.getByText('¡Luna ya está en casa!')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Ya apareció' })).toHaveCount(0)

  await page.goto('/mis-casos')
  await expect(page.getByText('Ya está en casa')).toBeVisible()
})

test('the owner deletes a false alarm', async ({ page }) => {
  await page.goto('/mis-casos')
  await page.getByRole('button', { name: 'Continuar con Google' }).click()
  await page.getByRole('heading', { name: 'Luna' }).click()

  await page.getByRole('button', { name: 'Eliminar aviso' }).click()
  await page.getByLabel('Fue una falsa alarma').check()
  await page.getByRole('dialog').getByRole('button', { name: 'Eliminar aviso' }).click()

  await expect(page.getByText('Este aviso fue cerrado.')).toBeVisible()
})
