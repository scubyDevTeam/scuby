import { expect, tags, test } from './test.ts'

test(
  'a shared link to an active lost case shows who, where and what to do',
  tags('@case-link', '@LINK-001'),
  async ({ casePage, profile }) => {
    await casePage.open('7K3PQ')

    await test.step('who is missing, and what a stranger can do', async () => {
      await expect(casePage.title('Luna')).toBeVisible()
      await expect(casePage.text('Se busca')).toBeVisible()
      await expect(casePage.sawIt).toBeVisible()
      await expect(casePage.haveIt).toBeVisible()
    })

    await test.step('the trajectory, newest first', async () => {
      await expect(casePage.sightings).toHaveCount(3)
      await expect(casePage.sightings.first()).toContainText('hace 2 h')
    })

    await test.step('the map loads after the page, on its own, and the family is reachable', async () => {
      await expect(casePage.map).toHaveAttribute('data-map-ready', 'true')
      await expect(casePage.whatsapp).toHaveAttribute('href', /^https:\/\/wa\.me\//)
    })

    await test.step('its owner, signed in, sees the possible find', async () => {
      await profile.open()
      await profile.signIn.withGoogle() // the emulation signs Google into the demo account, Luna’s owner
      await expect(profile.name('Carolina Mejía')).toBeVisible()
      await casePage.open('7K3PQ')
      // The owner's «Posible hallazgo» is the claims list (the page shows it instead of the public badge).
      await expect(casePage.claims).toBeVisible()
      await expect(casePage.claims.getByText('+573114829017')).toBeVisible()
      await expect(casePage.possibleFind).toHaveCount(0)
    })
  },
)

test(
  'the same link shows the reunion once the case is closed, with nothing left to do',
  tags('@case-link', '@LINK-002'),
  async ({ casePage }) => {
    await casePage.open('H4PPY')

    await test.step('the reunion, and no helper actions', async () => {
      await expect(casePage.text('¡Toby ya está en casa!')).toBeVisible()
      await expect(casePage.sawIt).toHaveCount(0)
      await expect(casePage.haveIt).toHaveCount(0)
    })
  },
)

test(
  'a purged code still resolves, so a printed poster never 404s',
  tags('@case-link', '@LINK-003'),
  async ({ casePage, page }) => {
    await test.step('the code says the case is gone', async () => {
      await casePage.open('GONE5')
      await expect(casePage.unavailable).toBeVisible()
    })

    await test.step('and leads to the other cases', async () => {
      await casePage.goToOtherCases()
      await expect(page).toHaveURL(/\/$/)
    })
  },
)

test(
  'sharing a case copies its link when the device has no share sheet',
  tags('@case-link', '@LINK-004'),
  async ({ casePage }) => {
    await casePage.withoutShareSheet()
    await casePage.open('7K3PQ')

    await casePage.share()

    await test.step('the link is copied', async () => {
      await expect(casePage.linkCopied).toBeVisible()
      expect(await casePage.copiedText()).toMatch(/\/c\/7K3PQ$/)
    })
  },
)
