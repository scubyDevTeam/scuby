// Bundles the share function (api/_share.ts) with what it reuses from src/ — the contract, the
// language files, t() — into api/_bundle/share.js, which api/share.ts re-exports, and puts the
// built shell beside it. Vercel runs it after the app build (vercel.json · buildCommand); see
// api/share.ts for why a bundle.
import { copyFileSync } from 'node:fs'
import { build } from 'vite'

await build({
  configFile: false,
  logLevel: 'warn',
  publicDir: false,
  build: {
    ssr: 'api/_share.ts',
    outDir: 'api/_bundle',
    emptyOutDir: false,
    target: 'node24',
    minify: false,
    rollupOptions: { output: { entryFileNames: 'share.js', format: 'es' } },
  },
  // Self-contained: zod goes in the bundle too, so nothing is resolved at run time.
  ssr: { noExternal: true },
})

// The shell the function fills: the built index.html, traced into the function with the bundle.
copyFileSync('dist/index.html', 'api/_bundle/shell.html')
