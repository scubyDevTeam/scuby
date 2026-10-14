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

export const handlers = [
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
