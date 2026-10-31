// The web client's Playwright config, pointed at the real backend on http://localhost:8080
// (backend/e2e/run-client-e2e.sh). Only where the app points and where output goes change.
import path from 'node:path'
import base from '../../web/playwright.config.ts'

const web = process.cwd()
const server = Array.isArray(base.webServer) ? base.webServer[0] : base.webServer

export default {
  ...base,
  testDir: path.join(web, 'e2e'),
  outputDir: process.env.SCUBY_E2E_OUTPUT ?? path.resolve(web, '../backend/e2e/results'),
  fullyParallel: false,
  workers: 1,
  webServer: {
    ...server,
    cwd: web,
    env: { ...server?.env, VITE_API_MOCK: 'false', VITE_API_URL: 'http://localhost:8080' },
  },
}
