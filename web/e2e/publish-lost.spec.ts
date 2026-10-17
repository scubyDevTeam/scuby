import { CasePage } from './pages/CasePage.ts'
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

test(
  'publishing a pet whose notice expired recently offers to reactivate it',
  tags('@publish-lost', '@PLOST-002'),
  async ({ publish, casePage }) => {
    await publish.openLostAsDemoOwner()

    await test.step('choosing the pet shows the offer instead of a blank form', async () => {
      await publish.choosePet('Pelusa')
      await expect(publish.reactivateOffer('Pelusa')).toBeVisible()
    })

    await test.step('one tap reactivates it and its page is active again', async () => {
      await publish.reactivate('Pelusa')
      await expect(publish.reactivated).toBeVisible()
      await publish.seeReactivated()
      await expect(casePage.title('Pelusa')).toBeVisible()
    })
  },
)

test(
  'a half-written lost notice survives a reload, on the step it was on',
  tags('@publish-lost', '@PLOST-003'),
  async ({ publish }) => {
    await publish.open()
    await publish.chooseLost()
    await publish.signIn.withEmailCode('ana.gomez@correo.co')
    await publish.name('Kira')
    await publish.describe({ species: 'Perro', size: 'Mediano', colour: 'Café' })
    await publish.next()

    await publish.reload()

    await test.step('the form says so and is where it was', async () => {
      await expect(publish.draftRestored).toBeVisible()
      await expect(publish.stepTitle).toHaveText('¿Dónde y cuándo?')
    })
  },
)

test(
  'what one tab changed, another tab sees: the demo keeps one backend per browser',
  tags('@publish-lost', '@PLOST-004'),
  async ({ myCases, casePage, context }) => {
    await myCases.openAsDemoOwner()
    await myCases.openCase('Luna')
    await casePage.editNotice('Collar azul con campanita')

    await test.step('a new tab opens the same case, with the change', async () => {
      const other = new CasePage(await context.newPage())
      await other.open('7K3PQ')
      await expect(other.text('Collar azul con campanita')).toBeVisible()
    })
  },
)
