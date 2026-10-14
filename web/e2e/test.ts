import { test as base } from '@playwright/test'
import { CasePage } from './pages/CasePage.ts'
import { FeedPage } from './pages/FeedPage.ts'
import { InboxPage } from './pages/InboxPage.ts'
import { Languages } from './pages/Languages.ts'
import { MyCasesPage } from './pages/MyCasesPage.ts'
import { ProfilePage } from './pages/ProfilePage.ts'
import { PublishPage } from './pages/PublishPage.ts'

export { expect } from '@playwright/test'
export { tags } from './tags.ts'

type Pages = {
  feed: FeedPage
  casePage: CasePage
  publish: PublishPage
  myCases: MyCasesPage
  inbox: InboxPage
  profile: ProfilePage
  languages: Languages
}

/**
 * Hermetic runs, one page object per screen. Map tiles: playwright.config.ts points the app at an
 * empty inline style. Links that leave the app (WhatsApp) are answered here, so no test depends
 * on someone else's server.
 */
export const test = base.extend<Pages>({
  context: async ({ context }, use) => {
    await context.route(/^https:\/\/wa\.me\//, (route) =>
      route.fulfill({ contentType: 'text/html', body: '<title>WhatsApp</title>' }),
    )
    await use(context)
  },
  feed: async ({ page }, use) => use(new FeedPage(page)),
  casePage: async ({ page }, use) => use(new CasePage(page)),
  publish: async ({ page }, use) => use(new PublishPage(page)),
  myCases: async ({ page }, use) => use(new MyCasesPage(page)),
  inbox: async ({ page }, use) => use(new InboxPage(page)),
  profile: async ({ page }, use) => use(new ProfilePage(page)),
  languages: async ({ page }, use) => use(new Languages(page)),
})
