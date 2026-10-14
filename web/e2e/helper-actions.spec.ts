import { expect, test } from './test.ts'

test('«La vi»: mark the spot on the map and the sighting joins the trajectory', async ({
  page,
}) => {
  await page.goto('/c/7K3PQ')
  const sightings = page.getByRole('list', { name: 'Avistamientos' }).getByRole('listitem')
  await expect(sightings).toHaveCount(3)

  await page.getByRole('button', { name: /La vi/ }).click()
  const picker = page.getByTestId('picker-map')
  await expect(picker).toHaveAttribute('data-map-ready', 'true')
  await picker.click()
  await expect(page.getByText('Punto marcado.')).toBeVisible()
  await page.getByLabel(/Nota/).fill('Iba hacia el parque')
  await page.getByRole('button', { name: 'Enviar avistamiento' }).click()

  await expect(page.getByText('¡Gracias!')).toBeVisible()
  await page.getByRole('button', { name: 'Listo' }).click()
  await expect(sightings).toHaveCount(4)
  await expect(sightings.first()).toContainText('Iba hacia el parque')
})

test('«La tengo conmigo»: leave a phone, the family is told, WhatsApp opens', async ({ page }) => {
  await page.goto('/c/M2TQ4')
  await expect(page.getByText('Posible hallazgo.')).toHaveCount(0)

  await page.getByRole('button', { name: 'La tengo conmigo' }).click()
  await page.getByLabel('Tu celular').fill('311 482 9017')
  const whatsapp = page.waitForEvent('popup')
  await page.getByRole('button', { name: /Avisar y abrir WhatsApp/ }).click()

  expect((await whatsapp).url()).toContain('wa.me')
  await expect(page.getByText('Ya le avisamos a su familia.')).toBeVisible()
  await page.getByRole('button', { name: 'Listo' }).click()
  // The claim exists whatever happens in WhatsApp: the page now says so.
  await expect(page.getByText('Posible hallazgo.')).toBeVisible()
})

test('«Reportar»: pick a reason and send, with no account', async ({ page }) => {
  await page.goto('/c/7K3PQ')

  await page.getByRole('button', { name: 'Reportar' }).click()
  await page.getByLabel('Muestra datos personales').check()
  await expect(page.getByText(/la ocultamos de inmediato/)).toBeVisible()
  await page.getByRole('button', { name: 'Enviar reporte' }).click()

  await expect(page.getByText('Gracias por avisar.')).toBeVisible()
})
