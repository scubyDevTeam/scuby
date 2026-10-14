import { expect, tags, test } from './test.ts'

test(
  'the owner answers a claim and closes the case as reunited',
  tags('@owner', '@OWNER-001'),
  async ({ myCases, casePage }) => {
    await myCases.openAsDemoOwner()
    await myCases.openCase('Luna')

    await test.step('the claimant’s number is a WhatsApp button, not text', async () => {
      await expect(casePage.claims.getByRole('link', { name: 'Abrir WhatsApp' })).toHaveAttribute(
        'href',
        'https://wa.me/573114829017',
      )
    })

    await test.step('confirming the claim leads to the close, its answer suggested', async () => {
      await casePage.confirmClaim('Luna')
      await expect(casePage.choice('Alguien la tenía y avisó aquí')).toBeChecked()
    })

    await test.step('the case closes as reunited', async () => {
      await casePage.closeAsReunited('Luna')
      await expect(casePage.text('¡Luna ya está en casa!')).toBeVisible()
      await expect(casePage.reunitedButton).toHaveCount(0)
    })

    await test.step('«Mis casos» says so', async () => {
      await myCases.open()
      await expect(myCases.status('Ya está en casa')).toBeVisible()
    })
  },
)

test(
  'the owner deletes a false alarm',
  tags('@owner', '@OWNER-002'),
  async ({ myCases, casePage }) => {
    await myCases.openAsDemoOwner()
    await myCases.openCase('Luna')

    await casePage.deleteAs('Fue una falsa alarma')

    await test.step('the case is closed', async () => {
      await expect(casePage.text('Este aviso fue cerrado.')).toBeVisible()
    })
  },
)
