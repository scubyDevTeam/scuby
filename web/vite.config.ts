import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

const layer = (name: string) => fileURLToPath(new URL(`./src/${name}`, import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  plugins: [tanstackRouter({ target: 'react', autoCodeSplitting: true }), react(), tailwindcss()],
  worker: { format: 'es' },
  // scripts/check-size.mjs reads the manifest to add up what one route really downloads.
  build: { manifest: true },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test-setup.ts'],
  },
  resolve: {
    // One alias per layer (docs/eng/frontend.md · Architecture). Mirror changes in tsconfig.app.json.
    alias: {
      '@routes': layer('routes'),
      '@features': layer('features'),
      '@api-client': layer('api-client'),
      '@contracts': layer('contracts'),
      '@domain': layer('domain'),
      '@platform': layer('platform'),
      '@ui': layer('ui'),
      '@i18n': layer('i18n'),
      '@mocks': layer('mocks'),
    },
  },
})
