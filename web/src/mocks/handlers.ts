import { delay, HttpResponse, http } from 'msw'
import { env } from '../env'
import { cases, feedItems, purgedCodes } from './fixtures'

const api = (path: string) => new URL(path, env.apiUrl).toString()

export const handlers = [
  http.get(api('/cases/:code'), async ({ params }) => {
    await delay(250)
    const code = String(params.code).toUpperCase()
    if (purgedCodes.has(code)) return new HttpResponse(null, { status: 410 })
    const found = cases()[code]
    return found ? HttpResponse.json(found) : new HttpResponse(null, { status: 404 })
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
