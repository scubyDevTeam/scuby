import { expect, tags, test } from './test.ts'

test(
  'the owner reads the inbox and opens the case a notification is about',
  tags('@inbox', '@INBOX-001'),
  async ({ myCases, inbox, casePage }) => {
    await myCases.openAsDemoOwner()

    await test.step('the «Bandeja» tab counts what is unread', async () => {
      await expect(inbox.navBadge).toHaveText('5 sin leer')
    })

    await inbox.openFromNav()

    await test.step('newest first, the unread ones told apart', async () => {
      await expect(inbox.items.first()).toContainText('Alguien dice que tiene a Luna')
      await expect(inbox.unread).toHaveCount(3)
      await expect(inbox.item('ya llegó a los vecinos')).not.toContainText('Sin leer')
    })

    await test.step('opening the inbox reads the alerts: only the messages still wait', async () => {
      await expect(inbox.navBadge).toHaveText('2 sin leer')
    })

    await test.step('a notification opens its case', async () => {
      await inbox.openNotification('Alguien dice que tiene a Luna')
      await expect(casePage.title('Luna')).toBeVisible()
    })
  },
)
