import { expect, tags, test } from './test.ts'

test(
  '«La vi»: mark the spot on the map and the sighting joins the trajectory',
  tags('@helper', '@HELP-001'),
  async ({ casePage }) => {
    await test.step('Luna has three sightings', async () => {
      await casePage.open('7K3PQ')
      await expect(casePage.sightings).toHaveCount(3)
    })

    await casePage.reportSighting('Iba hacia el parque')

    await test.step('the new sighting leads the trajectory', async () => {
      await expect(casePage.sightings).toHaveCount(4)
      await expect(casePage.sightings.first()).toContainText('Iba hacia el parque')
    })
  },
)

test(
  '«La tengo conmigo»: leave a phone, the family is told, WhatsApp opens',
  tags('@helper', '@HELP-002'),
  async ({ casePage }) => {
    await test.step('nobody has said they have Milo', async () => {
      await casePage.open('M2TQ4')
      await expect(casePage.possibleFind).toHaveCount(0)
    })

    await test.step('the claim opens WhatsApp with his family', async () => {
      expect(await casePage.claimRecovery('311 482 9017')).toContain('wa.me')
    })

    await test.step('the claim exists whatever happens in WhatsApp: the page says so', async () => {
      await expect(casePage.possibleFind).toBeVisible()
    })
  },
)

test(
  '«Reportar»: pick a reason and send, with no account',
  tags('@helper', '@HELP-003'),
  async ({ casePage }) => {
    await casePage.open('7K3PQ')

    await test.step('personal data is hidden at once, and the form says so', async () => {
      await casePage.startReport('Muestra datos personales')
      await expect(casePage.text('la ocultamos de inmediato')).toBeVisible()
    })

    await test.step('the report is sent', async () => {
      await casePage.sendReport()
      await expect(casePage.text('Gracias por avisar.')).toBeVisible()
    })
  },
)
