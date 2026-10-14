import { expect, test } from './test.ts'

test('«Es mío»: sign in on the way, offer proof, and reach whoever has the animal', async ({
  page,
}) => {
  await page.goto('/c/F8UND')
  await expect(page.getByRole('heading', { level: 1, name: 'Gato negro, pequeño' })).toBeVisible()
  await expect(page.getByText('Se encontró', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: /Es mío/ }).click()
  // Never anonymous: the account is born here, and the form follows.
  await page.getByLabel('Correo electrónico').fill('laura.diaz@correo.co')
  await page.getByRole('button', { name: 'Enviarme un código' }).click()
  await page.getByLabel(/Código de 6 dígitos/).fill('123456')

  await page.getByLabel(/Describe algo/).fill('Tiene una mancha blanca en la pata trasera')
  const whatsapp = page.waitForEvent('popup')
  await page.getByRole('button', { name: 'Avisar que es mío' }).click()

  expect((await whatsapp).url()).toContain('wa.me')
  await expect(page.getByText('Le avisamos a quien lo cuida.')).toBeVisible()
  await page.getByRole('button', { name: 'Listo' }).click()
  await expect(page.getByText('Posible dueño.')).toBeVisible()
})

test('the custodian checks a claim against what they withheld and hands the animal over', async ({
  page,
}) => {
  await page.goto('/mis-casos')
  await page.getByRole('button', { name: 'Continuar con Google' }).click()
  await page.getByRole('heading', { name: 'Perro café, mediano' }).click()

  const claims = page.getByRole('region', { name: 'Posibles dueños' })
  await expect(claims.getByText('Guardaste: «Collar verde con una campana».')).toBeVisible()
  await expect(claims.getByText('«Tiene un collar verde con campanita»')).toBeVisible()
  await claims.getByRole('button', { name: 'Sí, es el dueño' }).click()

  await expect(page.getByLabel('Su dueño lo vio aquí y me escribió')).toBeChecked()
  await page.getByRole('button', { name: 'Sí, ya está con su dueño' }).click()

  await expect(page.getByText('Ya está con su familia.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Ya está con su dueño' })).toHaveCount(0)
})

test('fifteen days with no owner: the custodian keeps the animal', async ({ page }) => {
  await page.goto('/mis-casos')
  await page.getByRole('button', { name: 'Continuar con Google' }).click()
  await page.getByRole('heading', { name: 'Perro café, mediano' }).click()

  const offer = page.getByRole('region', { name: 'Quince días sin dueño' })
  await offer.getByRole('button', { name: 'Me lo quedo' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Me lo quedo' }).click()

  await expect(page.getByText('Ya tiene hogar.')).toBeVisible()
})
