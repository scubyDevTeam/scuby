import { test as base } from '@playwright/test'

export { expect } from '@playwright/test'

/** Hermetic runs: the tile server is answered locally with an empty style (no streets, no network). */
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.route(/tiles\.openfreemap\.org/, (route) =>
      route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
    )
    await use(page)
  },
})
