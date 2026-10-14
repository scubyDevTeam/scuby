import { expect, tags, test } from './test.ts'

test(
  'the language lives in the URL, and switching it keeps the page',
  tags('@i18n', '@I18N-001'),
  async ({ languages, casePage, page }) => {
    await test.step('an /en address renders the app in English', async () => {
      await languages.open('/', 'en')
      await expect(languages.document).toHaveAttribute('lang', 'en')
      await expect(languages.tab('Main', 'My cases')).toBeVisible()
    })

    await test.step('its links keep the language', async () => {
      await languages.goToTab('Main', 'Profile')
      await expect(page).toHaveURL(/\/en\/perfil$/)
      await expect(languages.heading('Sign in to continue')).toBeVisible()
    })

    await test.step('switching to Spanish keeps the page and drops the segment', async () => {
      await languages.switchTo('Español')
      await expect(page).toHaveURL(/\/perfil$/)
      await expect(page).not.toHaveURL(/\/en\//)
      await expect(languages.heading('Entra para continuar')).toBeVisible()
      await expect(languages.document).toHaveAttribute('lang', 'es')
    })

    await test.step('Spanish has one address: /es/… is the page without a segment', async () => {
      await languages.open('/c/7K3PQ', 'es')
      await expect(page).toHaveURL(/\/c\/7K3PQ$/)
      await expect(casePage.title('Luna')).toBeVisible()
    })
  },
)
