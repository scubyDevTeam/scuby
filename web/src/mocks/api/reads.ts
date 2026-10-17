// What anyone reads (docs/product/04, 05, 10 §1, 00 · Geography).
import { api } from '../../contracts/api'
import { db, findCase } from '../db'
import { fail, route } from '../route'
import { caseView, DEFAULT_CENTER, feedView } from '../serialize'

export const reads = [
  route(api.getConfig, () => ({
    supported_countries: [
      {
        code: 'CO',
        phone_prefix: '+57',
        mobile_pattern: '^3\\d{9}$',
        default_center: DEFAULT_CENTER,
      },
    ],
  })),

  route(api.getCase, ({ params, user, reporterKey }) => {
    const code = params.code.toUpperCase()
    if (db.purged.includes(code)) fail('gone')
    const row = findCase(code) ?? fail('not_found')
    return caseView(db, row, user?.id ?? null, reporterKey)
  }),

  route(api.getFeed, ({ query }) => {
    const near =
      query.lat !== undefined && query.lng !== undefined ? { lat: query.lat, lng: query.lng } : null
    const feed = feedView(db, near)
    return {
      scope: feed.scope,
      items: feed.items.filter(
        (item) =>
          (!query.vertical || item.vertical === query.vertical) &&
          (!query.species || item.species === query.species),
      ),
    }
  }),
]
