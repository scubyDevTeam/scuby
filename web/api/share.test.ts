// docs/product/10 §2 · Link previews, and docs/eng/frontend.md · The one server-side thing.
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { readEnv } from './_env'
import { createShareHandler } from './_share'

// The real shell: if index.html loses a marker the function relies on, these tests say so.
const SHELL = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
const env = {
  apiUrl: 'https://api.example.test',
  publicOrigin: 'https://example.test',
  brandName: 'Huellas',
}

const lost = (fields: Record<string, unknown> = {}, pet: Record<string, unknown> = {}) => ({
  code: '7K3PQ',
  vertical: 'lost',
  status: 'active',
  resolved_at: null,
  viewer: 'public',
  pet: {
    name: 'Luna',
    species: 'dog',
    size: 'small',
    colors: ['black', 'tan'],
    marks: null,
    photo_urls: ['/img/abc123/card'],
    ...pet,
  },
  // 21:30 in Medellín is already the 11th in UTC: the preview keeps the place's calendar day.
  last_seen: {
    center: { lat: 6.25, lng: -75.6 },
    radius_m: 300,
    at: '2026-02-10T21:30:00-05:00',
    place_name: 'Santa Ana',
  },
  open_claim_count: 0,
  sightings: [],
  contact: null,
  ...fields,
})

const found = (status: string) => ({
  code: 'H4WXY',
  vertical: 'found',
  status,
  resolved_at: null,
  viewer: 'public',
  pet: { species: 'cat', size: 'small', colors: ['black'], marks: null, photo_urls: [] },
  found: {
    center: { lat: 6.25, lng: -75.6 },
    radius_m: 200,
    at: '2026-03-02T09:00:00-05:00',
    place_name: 'Laureles',
  },
  holding_where: 'home',
  held_since: '2026-03-02T09:00:00-05:00',
  hold_offer_at: '2026-03-17T09:00:00-05:00',
  open_claim_count: 0,
  contact: null,
})

function setup(answer: () => Promise<Response> | Response, options = { apiUrl: env.apiUrl }) {
  const fetch = vi.fn(async (_url: URL | string, _init?: RequestInit) => answer())
  const handler = createShareHandler({
    env: { ...env, ...options },
    fetch: fetch as unknown as typeof globalThis.fetch,
    shell: async () => SHELL,
  })
  return {
    fetch,
    open: async (path: string) => {
      const response = await handler(new Request(`https://example.test${path}`))
      const html = await response.text()
      const tag = (name: string) =>
        new RegExp(`<meta (?:property|name)="${name}" content="([^"]*)"`).exec(html)?.[1]
      return { status: response.status, html, tag }
    },
  }
}

const json = (body: unknown, status = 200) => Response.json(body, { status })
const failure = (code: string, status: number) => json({ error: { code, message: code } }, status)

describe('link preview of a case (docs/product/10 §2)', () => {
  it('an active lost case: label · name · barrio, traits and the day it went missing, the photo', async () => {
    const { open, fetch } = setup(() => json(lost()))
    const { status, html, tag } = await open('/api/share?code=7K3PQ')

    expect(status).toBe(200)
    expect(tag('og:title')).toBe('SE BUSCA: Luna — Santa Ana')
    expect(tag('og:description')).toBe(
      'Perro · Pequeño · Negro y canela · Se perdió el 10 de febrero',
    )
    expect(tag('og:url')).toBe('https://example.test/c/7K3PQ')
    expect(tag('og:image')).toBe('https://example.test/img/abc123/card')
    expect(tag('og:image:alt')).toBe('Foto de Luna')
    expect(tag('og:site_name')).toBe('Huellas')
    expect(tag('twitter:card')).toBe('summary_large_image')
    expect(tag('twitter:title')).toBe('SE BUSCA: Luna — Santa Ana')
    expect(html).toContain('<html lang="es"')
    expect(html).toContain('<title>SE BUSCA: Luna — Santa Ana</title>')

    // The contract's path, asked in the page's language.
    const [url, init] = fetch.mock.calls[0]!
    expect(String(url)).toBe('https://api.example.test/cases/7K3PQ')
    expect(new Headers(init?.headers).get('Accept-Language')).toBe('es')
  })

  it('reads before any JS runs: the summary is inside #root, the app script untouched', async () => {
    const { open } = setup(() => json(lost()))
    const { html } = await open('/api/share?code=7K3PQ')

    expect(html).toContain(
      '<div id="root"><article><h1>SE BUSCA: Luna — Santa Ana</h1><p>Perro · Pequeño · Negro y canela · Se perdió el 10 de febrero</p></article></div>',
    )
    expect(html).toContain('<script type="module" src="/src/main.tsx"></script>')
    expect(html.indexOf('<meta property="og:title"')).toBeLessThan(html.indexOf('</head>'))
  })

  it('/en/c/:code speaks English: the tags, the html lang, the page URL and the API request', async () => {
    const { open, fetch } = setup(() => json(lost()))
    const { html, tag } = await open('/api/share?code=7K3PQ&locale=en')

    expect(tag('og:title')).toBe('MISSING: Luna — Santa Ana')
    expect(tag('og:description')).toBe('Dog · Small · Black and tan · Lost on February 10')
    expect(tag('og:url')).toBe('https://example.test/en/c/7K3PQ')
    expect(html).toContain('<html lang="en"')
    expect(new Headers(fetch.mock.calls[0]![1]?.headers).get('Accept-Language')).toBe('en')
  })

  it('reads the code and the language from the original path when no query arrives', async () => {
    const { open } = setup(() => json(lost()))
    const { tag } = await open('/en/c/7K3PQ')
    expect(tag('og:title')).toBe('MISSING: Luna — Santa Ana')
  })

  it('an unknown language falls back to Spanish, whatever the parameter says', async () => {
    const { open } = setup(() => json(lost()))
    const { tag } = await open('/api/share?code=7K3PQ&locale=fr')
    expect(tag('og:title')).toBe('SE BUSCA: Luna — Santa Ana')
    expect((await open('/api/share?code=7K3PQ&locale=toString')).tag('og:title')).toBe(
      'SE BUSCA: Luna — Santa Ana',
    )
  })

  it('a reunited case says «ya está en casa», so an old forward sends nobody searching', async () => {
    const { open } = setup(() =>
      json(lost({ status: 'reunited', resolved_at: '2026-02-14T10:00:00-05:00' })),
    )
    const { tag } = await open('/api/share?code=7K3PQ')

    expect(tag('og:title')).toBe('YA ESTÁ EN CASA: Luna — Santa Ana')
    expect(tag('og:description')).toBe(
      '¡Luna ya está en casa! Gracias a quienes ayudaron a buscar.',
    )
  })

  it.each([
    ['expired', 'AVISO ARCHIVADO: Luna — Santa Ana', 'Este aviso fue archivado.'],
    ['cancelled', 'AVISO CERRADO: Luna — Santa Ana', 'Su familia cerró este aviso'],
  ])('a %s lost case shows its status, not a search', async (status, title, description) => {
    const { open } = setup(() => json(lost({ status })))
    const { tag } = await open('/api/share?code=7K3PQ')
    expect(tag('og:title')).toBe(title)
    expect(tag('og:description')).toContain(description)
  })

  it('a found case is titled by what the animal looks like, and its closed statuses say how it ended', async () => {
    const active = setup(() => json(found('active')))
    const open = await active.open('/api/share?code=H4WXY')
    expect(open.tag('og:title')).toBe('SE ENCONTRÓ: Gato negro, pequeño — Laureles')
    expect(open.tag('og:description')).toBe('Gato · Pequeño · Negro · Se encontró el 2 de marzo')
    // No photo: no image tag, and the smaller card.
    expect(open.tag('og:image')).toBeUndefined()
    expect(open.tag('twitter:card')).toBe('summary')

    const reunited = await setup(() => json(found('reunited'))).open('/api/share?code=H4WXY')
    expect(reunited.tag('og:title')).toBe('YA ESTÁ CON SU FAMILIA: Gato negro, pequeño — Laureles')
    expect(reunited.tag('og:description')).toBe('Ya está con su familia. Gracias a quien lo cuidó.')

    const english = await setup(() => json(found('kept'))).open('/api/share?code=H4WXY&locale=en')
    expect(english.tag('og:title')).toBe('HAS A HOME NOW: Black cat, small — Laureles')
  })

  it('an adoption listing: «EN ADOPCIÓN», and «ADOPTADO» once it found a home', async () => {
    const listing = (status: string) => ({
      code: 'M9RTV',
      vertical: 'adoption',
      status,
      resolution: status === 'adopted' ? 'adopted_offline' : null,
      published_at: '2026-03-01T10:00:00-05:00',
      resolved_at: null,
      viewer: 'public',
      pet: {
        name: 'Toby',
        species: 'dog',
        size: 'medium',
        colors: ['brown'],
        marks: null,
        photo_urls: ['https://cdn.example.test/img/def456/card'],
        health_flags: [],
      },
      story: 'Lo rescatamos en la calle.',
      temperament: [],
      requirement_flags: [],
      requirements: null,
      location: { center: { lat: 6.17, lng: -75.59 }, radius_m: 500, place_name: 'Envigado' },
      trust_tier: 'individual',
      lister_name: 'Fundación Patitas',
      reserved: false,
    })
    const active = await setup(() => json(listing('active'))).open('/api/share?code=M9RTV')
    expect(active.tag('og:title')).toBe('EN ADOPCIÓN: Toby — Envigado')
    expect(active.tag('og:description')).toBe('Perro · Mediano · Café · Busca un hogar')
    expect(active.tag('og:image')).toBe('https://cdn.example.test/img/def456/card')

    const adopted = await setup(() => json(listing('adopted'))).open('/api/share?code=M9RTV')
    expect(adopted.tag('og:title')).toBe('ADOPTADO: Toby — Envigado')
    expect(adopted.tag('og:description')).toContain('¡Toby ya tiene hogar!')
  })

  it('a help request previews with what it still needs — help in kind, never money (07)', async () => {
    const need = (kind: string, status: string) => ({
      id: kind,
      kind,
      detail: '…',
      target: 1,
      needed_by: null,
      status,
      confirmed: 0,
      pledged: 0,
    })
    const help = {
      code: 'HE7PA',
      vertical: 'help',
      status: 'active',
      resolution: null,
      published_at: '2026-10-10T09:00:00-05:00',
      resolved_at: null,
      viewer: 'public',
      pet: {
        name: 'Max',
        species: 'dog',
        size: 'large',
        colors: ['yellow'],
        marks: null,
        photo_urls: ['https://cdn.example.test/max.jpg'],
      },
      story: 'Lo operaron de la cadera.',
      location: { center: { lat: 6.17, lng: -75.58 }, radius_m: 1000, place_name: 'Envigado' },
      trust_tier: 'unverified',
      beneficiary_name: 'Julián R.',
      needs: [need('foster', 'open'), need('transport', 'open'), need('supplies', 'covered')],
    }
    const { tag } = await setup(() => json(help)).open('/api/share?code=HE7PA')
    expect(tag('og:title')).toBe('NECESITA AYUDA: Max — Envigado')
    expect(tag('og:description')).toBe(
      'Max necesita un hogar temporal y transporte. Ayuda en persona, nunca dinero.',
    )
    expect(tag('og:image')).toBe('https://cdn.example.test/max.jpg')

    const closed = { ...help, status: 'closed', resolution: 'covered' }
    const after = await setup(() => json(closed)).open('/api/share?code=HE7PA')
    expect(after.tag('og:title')).toBe('YA TIENE AYUDA: Max — Envigado')
    expect(after.tag('og:description')).toContain('Max ya tiene la ayuda que necesitaba')

    // Closed for another reason, it says it ended — never that the help arrived (10 §3).
    const ended = { ...help, status: 'closed', resolution: 'pet_deceased' }
    const gone = await setup(() => json(ended)).open('/api/share?code=HE7PA')
    expect(gone.tag('og:title')).toBe('SOLICITUD CERRADA: Max — Envigado')
    expect(gone.tag('og:description')).toBe('Quien la publicó cerró esta solicitud.')
  })

  it('a stand-in data: photo is no image to a crawler', async () => {
    const { open } = setup(() => json(lost({}, { photo_urls: ['data:image/svg+xml,%3Csvg%3E'] })))
    const { tag } = await open('/api/share?code=7K3PQ')
    expect(tag('og:image')).toBeUndefined()
  })
})

describe('when there is no case to show', () => {
  it('a purged case (410) still answers the shell, with neutral tags: a printed poster never 404s', async () => {
    const { open } = setup(() => failure('gone', 410))
    const { status, html, tag } = await open('/api/share?code=7K3PQ')

    expect(status).toBe(410)
    expect(tag('og:title')).toBe('Este aviso ya no está disponible')
    expect(tag('og:description')).toBe(
      'Quien lo publicó lo retiró. Mira otros avisos cerca de ti en Huellas.',
    )
    expect(tag('og:image')).toBeUndefined()
    expect(html).toContain('<script type="module" src="/src/main.tsx"></script>')
  })

  it('an unknown code (404) answers the shell with «no encontramos este aviso»', async () => {
    const { open } = setup(() => failure('not_found', 404))
    const { status, tag } = await open('/api/share?code=ZZZZZ')
    expect(status).toBe(404)
    expect(tag('og:title')).toBe('No encontramos este aviso')
  })

  it('a code that cannot be one is a 404 without asking the API', async () => {
    const { open, fetch } = setup(() => json(lost()))
    const { status, tag } = await open(`/api/share?code=${encodeURIComponent('../me/profile')}`)
    expect(status).toBe(404)
    expect(tag('og:title')).toBe('No encontramos este aviso')
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([
    ['the API fails', () => failure('server_error', 500)],
    ['the API is unreachable', () => Promise.reject(new TypeError('fetch failed'))],
    ['the API answers off-contract', () => json({ code: '7K3PQ', vertical: 'lost' })],
  ])('%s: the plain shell, never an error page', async (_, answer) => {
    const { open } = setup(answer)
    const { status, html } = await open('/api/share?code=7K3PQ')
    expect(status).toBe(200)
    expect(html).toBe(SHELL)
  })

  it('no API configured: the plain shell, and nothing is fetched', async () => {
    const { open, fetch } = setup(() => json(lost()), { apiUrl: undefined as unknown as string })
    const { html } = await open('/api/share?code=7K3PQ')
    expect(html).toBe(SHELL)
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('everything injected is escaped', () => {
  it('a name or a place cannot break out of an attribute or into the page', async () => {
    const name = '<script>alert(1)</script>" onload="x $& $1'
    const { open } = setup(() =>
      json(lost({ last_seen: { ...lost().last_seen, place_name: `Santa "Ana' <b>` } }, { name })),
    )
    const { html, tag } = await open('/api/share?code=7K3PQ')

    expect(html).not.toContain('<script>alert(1)')
    expect(html).not.toContain('" onload="x')
    expect(html).not.toContain('<b>')
    // Replacement patterns stay text.
    expect(tag('og:title')).toBe(
      'SE BUSCA: &#60;script&#62;alert(1)&#60;/script&#62;&#34; onload=&#34;x $&#38; $1 — Santa &#34;Ana&#39; &#60;b&#62;',
    )
  })
})

describe('configuration (api/_env.ts)', () => {
  it('reads the server keys, and a `mock-` API URL means none', () => {
    const base = { VITE_PUBLIC_ORIGIN: 'https://example.test', VITE_BRAND_NAME: 'Huellas' }
    expect(readEnv({ ...base, SHARE_API_URL: 'https://api.example.test' })).toEqual(env)
    expect(readEnv({ ...base, SHARE_API_URL: 'mock-api' }).apiUrl).toBeUndefined()
    expect(() => readEnv({})).toThrow(/VITE_PUBLIC_ORIGIN/)
  })
})
