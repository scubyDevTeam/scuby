import { test as base } from '@playwright/test'
import { AdoptionPage } from './pages/AdoptionPage.ts'
import { CasePage } from './pages/CasePage.ts'
import { ChatPage } from './pages/ChatPage.ts'
import { EmailLinkPage } from './pages/EmailLinkPage.ts'
import { FeedPage } from './pages/FeedPage.ts'
import { HelpPage } from './pages/HelpPage.ts'
import { InboxPage } from './pages/InboxPage.ts'
import { Languages } from './pages/Languages.ts'
import { LegalPage } from './pages/LegalPage.ts'
import { MyCasesPage } from './pages/MyCasesPage.ts'
import { ProfilePage } from './pages/ProfilePage.ts'
import { PublishPage } from './pages/PublishPage.ts'
import { PushOffer } from './pages/PushOffer.ts'

export { expect } from '@playwright/test'
export { tags } from './tags.ts'

type Pages = {
  /** Every test ends with no sideways scroll: a phone screen never pans (frontend.md · layout). */
  noHorizontalScroll: undefined
  adoption: AdoptionPage
  feed: FeedPage
  help: HelpPage
  casePage: CasePage
  chat: ChatPage
  emailLink: EmailLinkPage
  publish: PublishPage
  myCases: MyCasesPage
  inbox: InboxPage
  profile: ProfilePage
  languages: Languages
  legal: LegalPage
  push: PushOffer
}

/**
 * Hermetic runs, one page object per screen. Map tiles: playwright.config.ts points the app at an
 * empty inline style. Links that leave the app (WhatsApp) are answered here, so no test depends
 * on someone else's server.
 */
export const test = base.extend<Pages>({
  noHorizontalScroll: [
    async ({ page }, use) => {
      await use(undefined)
      if (page.isClosed()) return
      const overflow = await page
        .evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
        .catch(() => 0)
      if (overflow > 1)
        throw new Error(`The page scrolls sideways by ${overflow}px at ${page.url()}`)
    },
    { auto: true },
  ],
  context: async ({ context }, use) => {
    await context.route(/^https:\/\/wa\.me\//, (route) =>
      route.fulfill({ contentType: 'text/html', body: '<title>WhatsApp</title>' }),
    )
    await use(context)
  },
  adoption: async ({ page }, use) => use(new AdoptionPage(page)),
  feed: async ({ page }, use) => use(new FeedPage(page)),
  help: async ({ page }, use) => use(new HelpPage(page)),
  casePage: async ({ page }, use) => use(new CasePage(page)),
  chat: async ({ page }, use) => use(new ChatPage(page)),
  emailLink: async ({ page }, use) => use(new EmailLinkPage(page)),
  publish: async ({ page }, use) => use(new PublishPage(page)),
  myCases: async ({ page }, use) => use(new MyCasesPage(page)),
  inbox: async ({ page }, use) => use(new InboxPage(page)),
  profile: async ({ page }, use) => use(new ProfilePage(page)),
  languages: async ({ page }, use) => use(new Languages(page)),
  legal: async ({ page }, use) => use(new LegalPage(page)),
  push: async ({ page }, use) => use(new PushOffer(page)),
})
