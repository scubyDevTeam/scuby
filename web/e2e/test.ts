import { test as base } from '@playwright/test'

export { expect } from '@playwright/test'

/**
 * Hermetic runs. Map tiles: playwright.config.ts points the app at an empty inline style. Links
 * that leave the app (WhatsApp) are answered here, so no test depends on someone else's server.
 */
export const test = base.extend({
  context: async ({ context }, use) => {
    await context.route(/^https:\/\/wa\.me\//, (route) =>
      route.fulfill({ contentType: 'text/html', body: '<title>WhatsApp</title>' }),
    )
    await use(context)
  },
})
