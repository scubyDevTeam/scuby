import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { loadEnv, type Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vitest/config'
import { DEFERRED_NAMESPACES } from './src/i18n/namespaces.ts'

const layer = (name: string) => fileURLToPath(new URL(`./src/${name}`, import.meta.url))

/** A colour of the design tokens (src/ui/tokens.css): the manifest and the browser bar use the same. */
function token(name: string): string {
  const css = readFileSync(new URL('./src/ui/tokens.css', import.meta.url), 'utf8')
  const value = css.match(new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{3,8});`))?.[1]
  if (!value) throw new Error(`No --color-${name} in src/ui/tokens.css`)
  return value
}

const themeColor = (): Plugin => ({
  name: 'theme-color',
  transformIndexHtml: (html) => html.replace('__THEME_COLOR__', token('brand')),
})

/**
 * One JSON file per language is the source (src/i18n/locales/<lang>.json); the build cuts each into
 * `core` (first paint) and one chunk per deferred namespace, so a stranger opening a case link
 * downloads the words of that page, not of every form (docs/eng/frontend.md · Languages).
 */
function localeNamespaces(): Plugin {
  const PREFIX = 'virtual:messages/'
  const file = (lang: string) =>
    fileURLToPath(new URL(`./src/i18n/locales/${lang}.json`, import.meta.url))
  const deferred: readonly string[] = DEFERRED_NAMESPACES
  const languages = ['es', 'en']
  return {
    name: 'locale-namespaces',
    resolveId: (id) => (id.startsWith(PREFIX) ? `\0${id}` : undefined),
    load(id) {
      if (!id.startsWith(`\0${PREFIX}`)) return
      const path = id.slice(PREFIX.length + 1)
      if (path === 'loaders') {
        const entries = languages.map((lang) => {
          const parts = ['core', ...deferred].map(
            (part) => `${JSON.stringify(part)}: () => import('${PREFIX}${lang}/${part}')`,
          )
          return `${JSON.stringify(lang)}: { ${parts.join(', ')} }`
        })
        return `export const loaders = { ${entries.join(', ')} }`
      }
      // `<lang>/<part>`: the chunk takes the part's name, so `preview` can be kept out of the SW cache.
      const [lang, part] = path.split('/')
      if (!part || !lang || !languages.includes(lang)) return
      this.addWatchFile(file(lang))
      const all: Record<string, unknown> = JSON.parse(readFileSync(file(lang), 'utf8'))
      const picked =
        part === 'core'
          ? Object.fromEntries(Object.entries(all).filter(([ns]) => !deferred.includes(ns)))
          : { [part]: all[part] }
      return `export default ${JSON.stringify(picked)}`
    },
  }
}

/**
 * Sourcemaps to Sentry (docs/eng/frontend.md · Budgets), only with a real SENTRY_AUTH_TOKEN (`mock-…`
 * in .env = off, and the build is the same as without this). Uploaded under the build id the client
 * reports as its release, then deleted: they are never served. The release-and-URL upload, not the
 * debug-id one: that one stamps a snippet into every chunk, ≈3 KB gzip on the first load of
 * `/c/:code`, which leaves no room under its 150 KB.
 */
function sentrySourcemaps(mode: string, release: string): Plugin[] | undefined {
  const sentry = loadEnv(mode, process.cwd(), 'SENTRY_')
  const token = sentry.SENTRY_AUTH_TOKEN
  if (!token || token.startsWith('mock-')) return undefined
  return sentryVitePlugin({
    authToken: token,
    org: sentry.SENTRY_ORG,
    project: sentry.SENTRY_PROJECT,
    release: {
      name: release,
      // src/platform/errors.ts passes the release to Sentry.init itself.
      inject: false,
      uploadLegacySourcemaps: { paths: ['./dist/assets'], urlPrefix: '~/assets' },
    },
    sourcemaps: { disable: true, filesToDeleteAfterUpload: ['./dist*/**/*.map'] },
    telemetry: false,
  })
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // The product name is configuration (src/brand.ts reads the same keys at runtime).
  const brand = loadEnv(mode, process.cwd(), 'VITE_BRAND_')
  const apiMock = loadEnv(mode, process.cwd(), 'VITE_API_MOCK').VITE_API_MOCK === 'true'
  // Vercel's system env at build time; read by src/env.ts as the error reports' release and environment.
  const buildId = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA ?? 'local'
  const deployEnv = process.env.VERCEL_ENV ?? mode
  const sourcemaps = sentrySourcemaps(mode, buildId)
  return {
    define: {
      'import.meta.env.VITE_BUILD_ID': JSON.stringify(buildId),
      'import.meta.env.VITE_DEPLOY_ENV': JSON.stringify(deployEnv),
    },
    plugins: [
      localeNamespaces(),
      tanstackRouter({ target: 'react', autoCodeSplitting: true }),
      react(),
      tailwindcss(),
      themeColor(),
      // Installable shell + Web Push (docs/eng/frontend.md · Push; What the frontend owns,
      // Offline-ish). Our own worker, src/service-worker/sw.ts, for the push handlers; main.tsx
      // registers it (never with the emulated backend — see there).
      VitePWA({
        strategies: 'injectManifest',
        srcDir: 'src/service-worker',
        filename: 'sw.ts',
        injectRegister: false,
        // The icons are in the precache glob already.
        includeManifestIcons: false,
        manifest: {
          id: '/',
          name: brand.VITE_BRAND_NAME,
          short_name: brand.VITE_BRAND_SHORT_NAME,
          lang: 'es',
          start_url: '/',
          scope: '/',
          display: 'standalone',
          theme_color: token('brand'),
          background_color: token('surface'),
          icons: [
            { src: '/brand/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/brand/icon-512.png', sizes: '512x512', type: 'image/png' },
            {
              src: '/brand/icon-maskable-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        injectManifest: {
          // A classic script: registered without `type: 'module'`, which older Safari lacks.
          rollupFormat: 'iife',
          // The shell and the fonts. Not the map (lazy, and its tiles need the network anyway), and
          // not the emulated backend, which never runs next to this worker.
          globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
          globIgnores: [
            '**/maplibre*',
            '**/browser-*.js',
            'mockServiceWorker.js',
            // The link-preview words: only the server function reads them.
            '**/preview-*.js',
          ],
        },
      }),
      sourcemaps,
    ],
    worker: { format: 'es' },
    // scripts/check-size.mjs reads the manifest to add up what one route really downloads.
    build: {
      manifest: true,
      ...(sourcemaps ? { sourcemap: 'hidden' as const } : {}),
    },
    test: {
      environment: 'node',
      include: ['src/**/*.test.{ts,tsx}', 'api/**/*.test.ts'],
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
        // Without mocks, the emulated backend is not even in the module graph (src/mocks/off.ts).
        ...(apiMock
          ? {}
          : { '@mocks/browser': fileURLToPath(new URL('./src/mocks/off.ts', import.meta.url)) }),
        '@mocks': layer('mocks'),
      },
    },
  }
})
