// The one server-side thing (docs/eng/frontend.md): `/c/:code` and `/en/c/:code` come here
// (vercel.json). It fetches the public case, fills the built shell with og:/twitter: tags and a
// readable summary, and returns it — the same HTML for everyone, no user-agent sniffing; the SPA
// boots from it and React replaces the summary. What the tags say: _preview.ts.
import { readFileSync } from 'node:fs'
import { api, buildPath } from '../src/contracts/api'
import { caseWire } from '../src/contracts/case'
import { ERROR_STATUS } from '../src/contracts/errors'
import type { Locale, Messages } from '../src/i18n/locales'
import en from '../src/i18n/locales/en.json' with { type: 'json' }
import es from '../src/i18n/locales/es.json' with { type: 'json' }
import { createTranslator } from '../src/i18n/translate'
import { readEnv, type ShareEnv } from './_env'
import { casePreview, missingPreview, type Preview } from './_preview'

// Spanish is the source and has no URL segment (src/i18n/locales.ts — not importable here: it loads
// the language files through the build's virtual modules).
const SOURCE: Locale = 'es'
const MESSAGES: Record<Locale, Messages> = { es, en: en as Messages }
const isLocale = (value: string | null): value is Locale =>
  value !== null && Object.hasOwn(MESSAGES, value)

/** WhatsApp's crawler gives up after a few seconds; the plain shell is better than nothing. */
const API_TIMEOUT_MS = 2500

export type ShareDeps = {
  env: ShareEnv
  fetch: typeof fetch
  /** The built index.html. */
  shell: (request: Request) => Promise<string>
}

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

/** The rewrite passes `?code=&locale=`; the original path says the same, should it arrive instead. */
function target(request: Request): { code: string; locale: Locale } {
  const url = new URL(request.url)
  const path = /^\/(?:([a-z]{2})\/)?c\/([^/]+)/.exec(url.pathname)
  const code = url.searchParams.get('code') ?? path?.[2] ?? ''
  const locale = url.searchParams.get('locale') ?? path?.[1] ?? null
  return { code, locale: isLocale(locale) ? locale : SOURCE }
}

type Outcome = { status: number; preview: Preview | null }

async function lookUp(deps: ShareDeps, code: string, locale: Locale): Promise<Outcome> {
  const { env } = deps
  const i18n = createTranslator(locale, MESSAGES[locale], MESSAGES[SOURCE], {
    brand: env.brandName,
  })
  if (!/^[0-9A-Za-z]{1,32}$/.test(code)) {
    return { status: ERROR_STATUS.not_found, preview: missingPreview(i18n, 'not_found') }
  }
  // No API configured, down, slow or answering off-contract: the plain shell; the SPA tries itself.
  if (!env.apiUrl) return { status: 200, preview: null }
  try {
    const response = await deps.fetch(new URL(buildPath(api.getCase.path, { code }), env.apiUrl), {
      headers: { Accept: 'application/json', 'Accept-Language': locale },
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    })
    if (response.status === ERROR_STATUS.gone || response.status === ERROR_STATUS.not_found) {
      const kind = response.status === ERROR_STATUS.gone ? 'gone' : 'not_found'
      return { status: response.status, preview: missingPreview(i18n, kind) }
    }
    if (!response.ok) return { status: 200, preview: null }
    const wire = caseWire.parse(await response.json())
    return { status: 200, preview: casePreview(i18n, wire, env.publicOrigin) }
  } catch {
    return { status: 200, preview: null }
  }
}

function render(shell: string, preview: Preview, page: string, locale: Locale, env: ShareEnv) {
  const { title, description, image } = preview
  const meta = (key: 'property' | 'name', name: string, value: string) =>
    `<meta ${key}="${name}" content="${escapeHtml(value)}" />`
  const tags = [
    meta('name', 'description', description),
    meta('property', 'og:type', 'website'),
    meta('property', 'og:site_name', env.brandName),
    meta('property', 'og:title', title),
    meta('property', 'og:description', description),
    meta('property', 'og:url', page),
    ...(image
      ? [meta('property', 'og:image', image.url), meta('property', 'og:image:alt', image.alt)]
      : []),
    meta('name', 'twitter:card', image ? 'summary_large_image' : 'summary'),
    meta('name', 'twitter:title', title),
    meta('name', 'twitter:description', description),
    ...(image ? [meta('name', 'twitter:image', image.url)] : []),
  ]
  // Readable before any JS runs; createRoot() replaces it when the app boots.
  const summary = `<article><h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p></article>`
  // Replacer functions: a `$&` in a pet's name is text, not a replacement pattern.
  return shell
    .replace(/<html lang="[^"]*"/, () => `<html lang="${locale}"`)
    .replace(/<title>[^<]*<\/title>/, () => `<title>${escapeHtml(title)}</title>`)
    .replace('</head>', () => `  ${tags.join('\n    ')}\n  </head>`)
    .replace('<div id="root"></div>', () => `<div id="root">${summary}</div>`)
}

export function createShareHandler(deps: ShareDeps) {
  return async (request: Request): Promise<Response> => {
    const { code, locale } = target(request)
    const [shell, { status, preview }] = await Promise.all([
      deps.shell(request),
      lookUp(deps, code, locale),
    ])
    const segment = locale === SOURCE ? '' : `/${locale}`
    const page = `${deps.env.publicOrigin}${segment}/c/${encodeURIComponent(code)}`
    const html = preview ? render(shell, preview, page, locale, deps.env) : shell
    return new Response(html, {
      status,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        // A status change shows within a minute; the plain shell is never kept.
        'Cache-Control': preview
          ? 'public, max-age=0, s-maxage=60, stale-while-revalidate=300'
          : 'public, max-age=0, must-revalidate',
      },
    })
  }
}

// The built shell travels with the function: scripts/build-share.mjs copies dist/index.html next to
// the bundle. Should it be missing, the same file from the CDN.
let built: string | undefined
async function builtShell(request: Request): Promise<string> {
  if (built) return built
  try {
    built = readFileSync(new URL('./shell.html', import.meta.url), 'utf8')
    return built
  } catch {
    const response = await fetch(new URL('/index.html', request.url))
    if (!response.ok) throw new Error('No shell: /index.html did not answer 200')
    built = await response.text()
    return built
  }
}

let handler: ((request: Request) => Promise<Response>) | undefined

export default {
  fetch(request: Request) {
    handler ??= createShareHandler({ env: readEnv(), fetch, shell: builtShell })
    return handler(request)
  },
}
