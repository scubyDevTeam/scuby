import { expect, test } from './test.ts'

test('sign in with an emailed code, land where you were going, and sign out', async ({ page }) => {
  await page.goto('/perfil')
  await expect(page.getByRole('heading', { name: 'Entra para continuar' })).toBeVisible()

  await page.getByLabel('Correo electrónico').fill('juan.perez@correo.co')
  await page.getByRole('button', { name: 'Enviarme un código' }).click()
  await page.getByLabel(/Código de 6 dígitos/).fill('123456')

  await expect(page.getByRole('heading', { name: 'Juan Perez' })).toBeVisible()
  await expect(page.getByText('juan.perez@correo.co')).toBeVisible()

  // The session outlives a reload.
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Juan Perez' })).toBeVisible()

  await page.getByRole('button', { name: 'Cerrar sesión' }).click()
  await expect(page.getByRole('heading', { name: 'Entra para continuar' })).toBeVisible()
})

test('sign in with Google', async ({ page }) => {
  await page.goto('/mis-casos')

  await page.getByRole('button', { name: 'Continuar con Google' }).click()

  await expect(page.getByRole('heading', { name: 'Mis casos' })).toBeVisible()
})
