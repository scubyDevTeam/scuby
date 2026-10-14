import { expect, test } from './test.ts'

// A 1×1 PNG: enough for the photo pipeline to decode, re-encode and upload.
const photo = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)

test('publish a lost pet: sign in on the way, verify the phone, and see the case live', async ({
  page,
}) => {
  await page.goto('/publicar')
  await page.getByRole('link', { name: /Perdí a mi mascota/ }).click()

  // The account is born at the first step that needs one.
  await page.getByLabel('Correo electrónico').fill('ana.gomez@correo.co')
  await page.getByRole('button', { name: 'Enviarme un código' }).click()
  await page.getByLabel(/Código de 6 dígitos/).fill('123456')

  await page.getByLabel('Nombre').fill('Kira')
  await page
    .getByLabel(/Agregar foto/)
    .setInputFiles({ name: 'kira.png', mimeType: 'image/png', buffer: photo })
  await expect(page.getByRole('img', { name: 'Foto 1' })).toBeVisible()
  await page.getByRole('button', { name: 'Perro' }).click()
  await page.getByRole('button', { name: 'Mediano' }).click()
  await page.getByRole('button', { name: 'Café' }).click()
  await page.getByRole('button', { name: 'Continuar' }).click()

  const picker = page.getByTestId('picker-map')
  await expect(picker).toHaveAttribute('data-map-ready', 'true')
  await picker.click()
  await expect(page.getByText('Zona marcada.')).toBeVisible()
  await page.getByRole('button', { name: 'Ayer' }).click()
  await page.getByRole('button', { name: 'Continuar' }).click()

  await page.getByLabel('Tu celular').fill('300 715 2284')
  await page.getByRole('button', { name: 'Publicar y avisar a los vecinos' }).click()
  await page.getByLabel('Código que te enviamos por SMS').fill('123456')

  await expect(page.getByRole('heading', { name: '¡Aviso publicado!' })).toBeVisible()
  await page.getByRole('link', { name: 'Ver mi aviso' }).click()

  // The owner sees their own case, with the owner's actions.
  await expect(page.getByRole('heading', { level: 1, name: 'Kira' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Ya apareció' })).toBeVisible()

  await page.goto('/mis-casos')
  await expect(page.getByRole('heading', { name: 'Kira' })).toBeVisible()
  await page.goto('/')
  await expect(page.getByRole('article').first()).toContainText('Kira')
})
