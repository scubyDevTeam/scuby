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

test(
  'the owner answers «¿sigue perdida?» with «ya apareció» and the case closes',
  tags('@owner', '@OWNER-003'),
  async ({ myCases, casePage }) => {
    await myCases.open()
    await myCases.signIn.withEmailCode('julian@correo.co')
    await myCases.openCase('Milo')

    await test.step('the check-in waits, framed as the listing going away — on a date', async () => {
      await expect(casePage.checkin).toContainText('El aviso de Milo sigue publicado.')
      await expect(casePage.checkin).toContainText(/lo archivaremos el \d+ de \p{L}+/u)
      await expect(casePage.reunitedButton).toHaveCount(0)
    })

    await test.step('«Ya apareció» leads into the reunion, which asks who helped', async () => {
      await casePage.answerCheckin('Ya apareció 🎉')
      await casePage.pick('Apareció por otro lado')
      await casePage.closeAsReunited('Milo')
    })

    await test.step('the case closes as reunited and the question is gone', async () => {
      await expect(casePage.text('¡Milo ya está en casa!')).toBeVisible()
      await expect(casePage.checkin).toHaveCount(0)
    })
  },
)

test(
  'the owner stars a sighting and takes another off the map',
  tags('@owner', '@OWNER-004'),
  async ({ myCases, casePage }) => {
    await myCases.openAsDemoOwner()
    await myCases.openCase('Luna')

    await test.step('«Marcar como útil» stars the pin', async () => {
      await casePage.markUseful('Iba hacia el parque')
      await expect(casePage.usefulButton('Iba hacia el parque')).toHaveAttribute(
        'aria-pressed',
        'true',
      )
    })

    await test.step('a hidden pin leaves the trail and waits apart, for the owner only', async () => {
      await casePage.hideSighting('Corría asustada')
      await expect(casePage.sightings).toHaveCount(2)
      await expect(casePage.hiddenSightings).toHaveCount(1)
    })

    await test.step('and it can come back', async () => {
      await casePage.unhideSighting('Corría asustada')
      await expect(casePage.sightings).toHaveCount(3)
      await expect(casePage.hiddenSightings).toHaveCount(0)
    })
  },
)

test(
  'the owner edits the notice: the signs change on the page and no one is told again',
  tags('@owner', '@OWNER-005'),
  async ({ myCases, casePage, inbox }) => {
    await myCases.openAsDemoOwner()
    await myCases.openCase('Luna')

    await test.step('the notice shows its signs', async () => {
      await expect(casePage.text('Collar rojo con placa metálica')).toBeVisible()
    })

    await test.step('editing them is shown on the page at once', async () => {
      await casePage.editNotice('Collar azul con campanita')
      await expect(casePage.text('Collar azul con campanita')).toBeVisible()
      await expect(casePage.text('Collar rojo con placa metálica')).toHaveCount(0)
    })

    await test.step('and sends no new notification', async () => {
      await inbox.open()
      await expect(inbox.items).toHaveCount(4)
    })
  },
)

test(
  'the publisher edits an adoption listing, a help request and a found notice',
  tags('@owner', '@OWNER-006'),
  async ({ myCases, casePage }) => {
    await myCases.openAsDemoOwner()

    await test.step('the adoption listing’s story changes on its page', async () => {
      await myCases.openCase('Misha')
      await casePage.editNoticeField('Historia', 'Es juguetona y busca casa con otro gato.')
      await expect(casePage.text('Es juguetona y busca casa con otro gato.')).toBeVisible()
    })

    await test.step('the help request’s story changes on its page', async () => {
      await myCases.open()
      await myCases.openCase('Nala')
      await casePage.editNoticeField('Historia', 'Ya tiene cita en la veterinaria.')
      await expect(casePage.text('Ya tiene cita en la veterinaria.')).toBeVisible()
    })

    await test.step('the found notice’s signs change on its page', async () => {
      await myCases.open()
      await myCases.openCase('Perro café, mediano')
      await casePage.editNoticeField(/Señas/, 'Collar verde nuevo')
      await expect(casePage.text('Collar verde nuevo')).toBeVisible()
    })
  },
)
