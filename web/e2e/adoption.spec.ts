import { expect, tags, test } from './test.ts'

test(
  '«Me interesa»: a visitor introduces themselves, verifies their number and reaches the lister',
  tags('@adoption', '@ADOPT-001'),
  async ({ adoption }) => {
    await test.step('a stranger opens Nube’s listing: the fee is disclosed, no contact yet', async () => {
      await adoption.open('AD9PT')
      await expect(adoption.title('Nube')).toBeVisible()
      await expect(adoption.fee('Sin cuota')).toBeVisible()
    })

    await test.step('«Me interesa» needs an account: it is born here', async () => {
      await adoption.sayInterested()
      await adoption.signIn.withEmailCode('laura.diaz@correo.co')
    })

    await test.step('the intro first, then the number, then WhatsApp opens with it prefilled', async () => {
      await adoption.introduce({ housing: 'Apartamento', yard: 'No', why: 'Trabajo desde casa.' })
      const url = decodeURIComponent(await adoption.sendVerifying('300 111 2233'))
      expect(url).toContain('wa.me/573000000005')
      expect(url).toContain('Hola, me interesa adoptar a Nube')
      await expect(adoption.adopterSafety).toBeVisible()
    })

    await test.step('back on the listing, the interest is on record', async () => {
      await adoption.done()
      await expect(adoption.interestedNote).toBeVisible()
    })
  },
)

test(
  'the lister reads the intros, chooses someone and records the adoption',
  tags('@adoption', '@ADOPT-002'),
  async ({ myCases, adoption }) => {
    await myCases.openAsDemoOwner()
    await myCases.openCase('Misha')

    await test.step('a list of people with their intros and account facts, never a verdict', async () => {
      await expect(adoption.person('Andrés R.').getByText('Sin patio')).toBeVisible()
      await expect(
        adoption.person('Andrés R.').getByText(/tiene 3 solicitudes de adopción abiertas/),
      ).toBeVisible()
    })

    await test.step('choosing Julián puts the listing «en proceso»', async () => {
      await adoption.choose('Julián R.')
      await expect(adoption.text('En proceso').first()).toBeVisible()
    })

    await test.step('the adoption is recorded: the responsibility moves to Julián', async () => {
      await adoption.recordAdoptionBy('Julián R.')
      await expect(adoption.text('¡Misha ya tiene hogar!')).toBeVisible()
    })
  },
)
