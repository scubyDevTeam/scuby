import { expect, tags, test } from './test.ts'

test(
  'the consent line opens the terms and the data policy, both marked as drafts',
  tags('@legal', '@LEGAL-001'),
  async ({ legal }) => {
    await test.step('signing in asks for consent with both documents linked', async () => {
      await legal.openSignIn()
      await expect(legal.consentTerms).toBeVisible()
      await expect(legal.consentPrivacy).toBeVisible()
    })

    const terms = await test.step('the terms open in a new tab, as a draft', async () => {
      const tab = await legal.readTermsFromConsent()
      await expect(tab.title('Términos y condiciones')).toBeVisible()
      await expect(tab.section('Facilitamos el contacto, nada más')).toBeVisible()
      await expect(tab.draft).toBeVisible()
      return tab
    })

    await test.step('and lead to the data policy and its rights', async () => {
      await terms.goToPrivacy()
      await expect(terms.title('Política de tratamiento de datos')).toBeVisible()
      await expect(terms.section('Tus derechos')).toBeVisible()
    })
  },
)
