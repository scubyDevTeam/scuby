import { expect, test } from './test.ts'

const photo = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)
const file = { name: 'animal.png', mimeType: 'image/png', buffer: photo }

test('found an animal and have it: nobody is searching for one like it, so the case is published', async ({
  page,
}) => {
  await page.goto('/publicar')
  await page.getByRole('link', { name: /Encontré un animal/ }).click()
  await page.getByRole('link', { name: 'Sí, lo tengo conmigo' }).click()
  await page.getByRole('button', { name: 'Continuar con Google' }).click()

  await page.getByLabel(/Agregar foto/).setInputFiles(file)
  await expect(page.getByRole('img', { name: 'Foto 1' })).toBeVisible()
  await page.getByRole('button', { name: 'Otro' }).click()
  await page.getByRole('button', { name: 'Pequeño' }).click()
  await page.getByLabel(/Guarda un dato/).fill('Tiene un anillo azul en la pata')
  await page.getByRole('button', { name: 'Continuar' }).click()

  const picker = page.getByTestId('picker-map')
  await expect(picker).toHaveAttribute('data-map-ready', 'true')
  await picker.click()
  await page.getByRole('button', { name: 'Ayer' }).click()
  await page.getByRole('button', { name: 'Continuar' }).click()

  await page.getByLabel('Tu celular').fill('300 715 2284')
  await page.getByRole('button', { name: 'Publicar y avisar a los vecinos' }).click()
  await page.getByLabel('Código que te enviamos por SMS').fill('123456')

  await expect(page.getByRole('heading', { name: '¡Aviso publicado!' })).toBeVisible()
  await page.getByRole('link', { name: 'Ver mi aviso' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Animal, pequeño' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Ya está con su dueño' })).toBeVisible()
})

test('found an animal someone is searching for: it becomes a claim on their case, not a new card', async ({
  page,
}) => {
  await page.goto('/publicar/encontrado')
  await page.getByRole('link', { name: 'Sí, lo tengo conmigo' }).click()
  await page.getByLabel('Correo electrónico').fill('pedro.ruiz@correo.co')
  await page.getByRole('button', { name: 'Enviarme un código' }).click()
  await page.getByLabel(/Código de 6 dígitos/).fill('123456')

  await page.getByLabel(/Agregar foto/).setInputFiles(file)
  await expect(page.getByRole('img', { name: 'Foto 1' })).toBeVisible()
  await page.getByRole('button', { name: 'Perro' }).click()
  await page.getByRole('button', { name: 'Pequeño' }).click()
  await page.getByRole('button', { name: 'Continuar' }).click()
  const picker = page.getByTestId('picker-map')
  await expect(picker).toHaveAttribute('data-map-ready', 'true')
  await picker.click()
  await page.getByRole('button', { name: 'Ayer' }).click()
  await page.getByRole('button', { name: 'Continuar' }).click()

  await expect(page.getByRole('heading', { name: '¿Es alguno de estos?' })).toBeVisible()
  await page.getByRole('button', { name: 'Sí, es Luna' }).click()
  await page.getByLabel('Tu celular').fill('300 715 2284')
  const whatsapp = page.waitForEvent('popup')
  await page.getByRole('button', { name: /Avisar y abrir WhatsApp/ }).click()

  expect((await whatsapp).url()).toContain('wa.me')
  await expect(page.getByText('Ya le avisamos a su familia.')).toBeVisible()
})

test('only saw an animal: no account, and the report joins the case of the pet it looks like', async ({
  page,
}) => {
  await page.goto('/publicar/encontrado')
  await page.getByRole('link', { name: 'No, solo lo vi' }).click()

  await page.getByLabel(/Agregar foto/).setInputFiles(file)
  await expect(page.getByRole('img', { name: 'Foto 1' })).toBeVisible()
  await page.getByRole('button', { name: 'Gato' }).click()
  const picker = page.getByTestId('picker-map')
  await expect(picker).toHaveAttribute('data-map-ready', 'true')
  await picker.click()
  await page.getByRole('button', { name: 'Enviar reporte' }).click()

  await page.getByRole('button', { name: 'Sí, es Milo' }).click()
  await expect(page.getByRole('heading', { name: '¡Gracias por avisar!' })).toBeVisible()

  await page.goto('/c/M2TQ4')
  await expect(page.getByRole('list', { name: 'Avistamientos' }).getByRole('listitem')).toHaveCount(
    1,
  )
})
