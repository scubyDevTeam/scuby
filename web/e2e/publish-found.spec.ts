import { expect, tags, test } from './test.ts'

test(
  'found an animal and have it: nobody is searching for one like it, so the case is published',
  tags('@publish-found', '@PFOUND-001'),
  async ({ publish, casePage }) => {
    await test.step('the finder has the animal, and signs in', async () => {
      await publish.open()
      await publish.chooseFound()
      await publish.iHaveIt()
      await publish.signIn.withGoogle()
    })

    await test.step('what it looks like, and a detail kept back to check owners against', async () => {
      await publish.photos.add()
      await publish.describe({ species: 'Otro', size: 'Pequeño' })
      await publish.withhold('Tiene un anillo azul en la pata')
      await publish.next()
    })

    await test.step('where and when', async () => {
      await publish.map.mark()
      await publish.when('Ayer')
    })

    await test.step('no lost pet matches: the phone is verified and the case goes live', async () => {
      await publish.phone.publishVerifying('300 715 2284')
      await publish.published.openCase()
      await expect(casePage.title('Animal, pequeño')).toBeVisible()
      await expect(casePage.backWithOwner).toBeVisible()
    })
  },
)

test(
  'found an animal someone is searching for: it becomes a claim on their case, not a new card',
  tags('@publish-found', '@PFOUND-002'),
  async ({ publish }) => {
    await test.step('the finder has the animal, and signs in', async () => {
      await publish.openFound()
      await publish.iHaveIt()
      await publish.signIn.withEmailCode('pedro.ruiz@correo.co')
    })

    await test.step('what, where and when', async () => {
      await publish.photos.add()
      await publish.describe({ species: 'Perro', size: 'Pequeño' })
      await publish.next()
      await publish.map.mark()
      await publish.when('Ayer')
    })

    await test.step('a lost dog nearby matches, and the finder recognises Luna', async () => {
      await expect(publish.candidates).toBeVisible()
      await publish.itIs('Luna')
    })

    await test.step('her family is told and WhatsApp opens', async () => {
      expect(await publish.tellTheFamily('300 715 2284')).toContain('wa.me')
      await expect(publish.familyTold).toBeVisible()
    })
  },
)

test(
  'only saw an animal: no account, and the report joins the case of the pet it looks like',
  tags('@publish-found', '@PFOUND-003'),
  async ({ publish, casePage }) => {
    await test.step('a witness reports without an account', async () => {
      await publish.openFound()
      await publish.iOnlySawIt()
      await publish.photos.add()
      await publish.describe({ species: 'Gato' })
      await publish.map.mark()
      await publish.sendWitnessReport()
    })

    await test.step('the witness recognises Milo', async () => {
      await publish.itIs('Milo')
      await expect(publish.thanks).toBeVisible()
    })

    await test.step('the report joins Milo’s trajectory', async () => {
      await casePage.open('M2TQ4')
      await expect(casePage.sightings).toHaveCount(1)
    })
  },
)
