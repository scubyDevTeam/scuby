import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const layer = (name: string) => fileURLToPath(new URL(`./src/${name}`, import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
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
