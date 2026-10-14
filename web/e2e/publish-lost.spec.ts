import { expect, tags, test } from './test.ts'

test(
  'publish a lost pet: sign in on the way, verify the phone, and see the case live',
  tags('@publish-lost', '@PLOST-001'),
  async ({ publish, casePage, myCases, feed }) => {
    await test.step('the account is born at the first step that needs one', async () => {
      await publish.open()
      await publish.chooseLost()
      await publish.signIn.withEmailCode('ana.gomez@correo.co')
    })

    await test.step('who is missing', async () => {
      await publish.name('Kira')
      await publish.photos.add('kira.png')
      await publish.describe({ species: 'Perro', size: 'Mediano', colour: 'Café' })
      await publish.next()
    })

    await test.step('where and when', async () => {
      await publish.map.mark()
      await publish.when('Ayer')
    })

    await test.step('the phone is verified and the case goes live', async () => {
      await publish.phone.publishVerifying('300 715 2284')
      await publish.published.openCase()
    })

    await test.step('the owner sees their own case, with the owner’s actions', async () => {
      await expect(casePage.title('Kira')).toBeVisible()
      await expect(casePage.reunitedButton).toBeVisible()
    })

    await test.step('it is in «Mis casos» and leads the feed', async () => {
      await myCases.open()
      await expect(myCases.item('Kira')).toBeVisible()
      await feed.open()
      await expect(feed.articles.first()).toContainText('Kira')
    })
  },
)
