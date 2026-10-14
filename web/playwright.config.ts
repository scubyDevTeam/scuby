import { defineConfig, devices } from '@playwright/test'

const PORT = 4173

// Happy paths only (docs/eng/frontend.md · Testing): one per feature, against the mocked API.
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: `http://localhost:${PORT}`, trace: 'on-first-retry' },
  projects: [
    {
      // The reference device is a low-end Android: phone viewport, touch, Chromium.
      name: 'mobile',
      // Locally, drive the installed Chrome instead of downloading a browser.
      use: { ...devices['Pixel 7'], channel: process.env.CI ? undefined : 'chrome' },
    },
  ],
  webServer: {
    command: `pnpm exec vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    // Always its own server: it runs with test-only env, which a dev server would not have.
    reuseExistingServer: false,
    env: {
      VITE_API_MOCK: 'true',
      // An empty map style, inline: maps load and work with no streets and no network.
      VITE_MAP_STYLE_URL: 'data:application/json,{"version":8,"sources":{},"layers":[]}',
    },
  },
})
