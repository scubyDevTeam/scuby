import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

const layer = (name: string) => fileURLToPath(new URL(`./src/${name}`, import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  plugins: [tanstackRouter({ target: 'react', autoCodeSplitting: true }), react(), tailwindcss()],
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
      '@mocks': layer('mocks'),
    },
  },
})
