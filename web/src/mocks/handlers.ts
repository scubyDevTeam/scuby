import { delay, HttpResponse, http } from 'msw'
import { env } from '../env'
import { db, newId } from './db'
import { feedItems, purgedCodes } from './fixtures'

const api = (path: string) => new URL(path, env.apiUrl).toString()

const lostCase = (code: unknown) => {
  const found = db.cases[String(code).toUpperCase()]
  return found?.vertical === 'lost' ? found : undefined
}

type SightingBody = { point: { lat: number; lng: number }; seen_at: string; note: string | null }

/** The code the emulated backend accepts. The app shows it while mocks are on. */
export const DEMO_CODE = '123456'

const SESSION_KEY = 'mock-session'
const readSession = () => {
  const stored = localStorage.getItem(SESSION_KEY)
  return stored ? (JSON.parse(stored) as { id: string; display_name: string; email: string }) : null
}
const signIn = (email: string, displayName: string) => {
  const user = { id: 'user-1', display_name: displayName, email }
  localStorage.setItem(SESSION_KEY, JSON.stringify(user))
  return HttpResponse.json(user)
}
/** «juan.perez@correo.co» → «Juan Perez», until the profile lets people name themselves. */
const nameFrom = (email: string) =>
  (email.split('@')[0] ?? '')
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(' ')

export const handlers = [
  http.get(api('/session'), () => {
    const user = readSession()
    return user ? HttpResponse.json(user) : new HttpResponse(null, { status: 401 })
  }),

  http.post(api('/auth/email/start'), async () => {
    await delay(250)
    return new HttpResponse(null, { status: 204 })
  }),

  http.post(api('/auth/email/verify'), async ({ request }) => {
    await delay(250)
    const { email, code } = (await request.json()) as { email: string; code: string }
    if (code !== DEMO_CODE) return new HttpResponse(null, { status: 422 })
    return signIn(email, nameFrom(email))
  }),

  http.post(api('/auth/google'), async () => {
    await delay(250)
    return signIn('carolina@correo.co', 'Carolina Mejía')
  }),

  http.post(api('/auth/sign-out'), () => {
    localStorage.removeItem(SESSION_KEY)
    return new HttpResponse(null, { status: 204 })
  }),

  http.get(api('/config'), () =>
    HttpResponse.json({
      supported_countries: [{ code: 'CO', phone_prefix: '+57', mobile_pattern: '^3\\d{9}$' }],
    }),
  ),

  http.get(api('/cases/:code'), async ({ params }) => {
    await delay(250)
    const code = String(params.code).toUpperCase()
    if (purgedCodes.has(code)) return new HttpResponse(null, { status: 410 })
    const found = db.cases[code]
    return found ? HttpResponse.json(found) : new HttpResponse(null, { status: 404 })
  }),

  http.post(api('/cases/:code/sightings'), async ({ params, request }) => {
    await delay(250)
    const found = lostCase(params.code)
    if (!found) return new HttpResponse(null, { status: 404 })
    const body = (await request.json()) as SightingBody
    const id = newId('s-new-')
    found.sightings.push({
      id,
      point: body.point,
      seen_at: body.seen_at,
      note: body.note,
      photo_url: null,
      source: 'anonymous',
      highlighted_by_owner: false,
    })
    return HttpResponse.json({ id }, { status: 201 })
  }),

  http.post(api('/cases/:code/recovery-claims'), async ({ params }) => {
    await delay(250)
    const found = lostCase(params.code)
    if (!found) return new HttpResponse(null, { status: 404 })
    // The row exists before the channel opens: the badge appears whatever happens in WhatsApp.
    found.open_claim_count += 1
    return HttpResponse.json(
      { id: newId('claim-'), whatsapp_url: found.contact?.whatsapp_url ?? null },
      { status: 201 },
    )
  }),

  http.post(api('/reports'), async () => {
    await delay(250)
    return HttpResponse.json({ id: newId('report-') }, { status: 201 })
  }),

  http.get(api('/feed'), async ({ request }) => {
    await delay(250)
    const query = new URL(request.url).searchParams
    const vertical = query.get('vertical')
    const species = query.get('species')
    const items = feedItems().filter(
      (item) => (!vertical || item.vertical === vertical) && (!species || item.species === species),
    )
    return HttpResponse.json({ scope: 'local', items })
  }),
]
