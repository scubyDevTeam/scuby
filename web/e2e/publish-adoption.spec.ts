import { expect, tags, test } from './test.ts'

test(
  'list a rescued cat for adoption: sign in, tell her story, disclose the fee, verify the phone',
  tags('@publish-adoption', '@PADOPT-001'),
  async ({ publish, adoption }) => {
    await test.step('«Dar en adopción» asks for an account', async () => {
      await publish.open()
      await publish.chooseAdoption()
      await publish.signIn.withEmailCode('ana.gomez@correo.co')
    })

    await test.step('who is looking for a home', async () => {
      await publish.nameListing('Pelusa', 'Lo rescaté o lo cuido')
      await publish.photos.add()
      await publish.describe({ species: 'Gato', size: 'Pequeño' })
      await publish.next()
    })

    await test.step('her story, and the fee disclosed even when there is none', async () => {
      await publish.tellStory('La encontré en una caja en Robledo. Es muy cariñosa.')
    })

    await test.step('where she is, then the phone step, and the listing is live', async () => {
      await publish.map.mark()
      await publish.phone.publishVerifying('300 715 2284', undefined, 'Publicar en adopción')
      await publish.published.openListing()
      await expect(adoption.title('Pelusa')).toBeVisible()
      await expect(adoption.fee('Sin cuota')).toBeVisible()
      await expect(adoption.noInterestsYet).toBeVisible()
    })
  },
)

test(
  'fifteen days with no owner: the custodian lists the dog for adoption, on the same pet',
  tags('@publish-adoption', '@PADOPT-002'),
  async ({ myCases, casePage, publish, adoption }) => {
    await myCases.openAsDemoOwner()
    await myCases.openCase('Perro café, mediano')

    await test.step('the day-15 offer opens the listing form, pre-filled from the found case', async () => {
      await casePage.listForAdoption()
      await publish.nameListing('Tito')
      await publish.next()
      await publish.tellStory('')
    })

    await test.step('the area comes from the found case: verify the phone and publish', async () => {
      await publish.phone.publishVerifying('300 715 2284', undefined, 'Publicar en adopción')
      await publish.published.openListing()
      await expect(adoption.title('Tito')).toBeVisible()
      await expect(adoption.text(/Lo encontraron en Estadio el/)).toBeVisible()
    })
  },
)
