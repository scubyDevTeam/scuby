import { DEMO_LINK_TOKENS } from './pages/EmailLinkPage.ts'
import { expect, tags, test } from './test.ts'

// The email's one-tap buttons (docs/eng/comms.md · Actionable check-ins, The scanner rule).

test(
  'a safe button answers on open and thanks, without a session',
  tags('@email-links', '@MAIL-001'),
  async ({ emailLink }) => {
    await emailLink.open(DEMO_LINK_TOKENS.mishaStillAvailable)

    await test.step('opening it was the answer: it thanks', async () => {
      await expect(emailLink.heading('Gracias, sigue publicada')).toBeVisible()
      await expect(emailLink.page.getByRole('button')).toHaveCount(0)
    })

    await test.step('it is single-use: opening it again changes nothing', async () => {
      await emailLink.reopen()
      await expect(emailLink.heading('Ya tenemos tu respuesta')).toBeVisible()
    })

    await test.step('it leads to the listing', async () => {
      await emailLink.viewCase('Ver la publicación')
      await expect(emailLink.page).toHaveURL(/\/c\/M1SHI$/)
    })
  },
)

test(
  'a consequential button asks to confirm, and confirming answers the question everywhere',
  tags('@email-links', '@MAIL-002'),
  async ({ myCases, emailLink, casePage }) => {
    await myCases.open()
    await myCases.signIn.withEmailCode('julian@correo.co')

    await test.step('Julián is signed in, with Milo among his cases', async () => {
      await expect(myCases.item('Milo')).toBeVisible()
    })

    await test.step('home shows the question Milo’s owner owes', async () => {
      await emailLink.openHome()
      await expect(emailLink.homeBanner).toContainText('El aviso de Milo espera tu respuesta.')
    })

    await emailLink.open(DEMO_LINK_TOKENS.miloReunited)

    await test.step('opening it only asks — a scanner opening it again changes nothing', async () => {
      await expect(emailLink.heading('¿Confirmas que Milo ya apareció?')).toBeVisible()
      await emailLink.reopen()
      await expect(emailLink.heading('¿Confirmas que Milo ya apareció?')).toBeVisible()
    })

    await test.step('the one button answers', async () => {
      await emailLink.confirm('Sí, ya apareció')
      await expect(emailLink.heading('¡Milo ya está en casa!')).toBeVisible()
    })

    await test.step('the case no longer asks, and neither does home', async () => {
      await emailLink.viewCase('Ver el aviso')
      await expect(casePage.text('¡Milo ya está en casa!')).toBeVisible()
      await expect(casePage.checkin).toHaveCount(0)
      await emailLink.openHome()
      await expect(emailLink.page.getByRole('heading', { level: 1 })).toBeVisible()
      await expect(emailLink.homeBanner).toHaveCount(0)
    })
  },
)
