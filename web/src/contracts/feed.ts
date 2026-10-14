// The feed: open cases, nearest first, national when nothing is near (docs/product/00 · Geography).
import * as z from 'zod/mini'
import { point, speciesSchema, timestamp, verticalSchema } from './primitives'

/** All optional. Without `lat`/`lng` the server cannot tell what is near and answers nationally. */
export const feedQuerySchema = z.object({
  vertical: z.optional(verticalSchema),
  species: z.optional(speciesSchema),
  lat: z.optional(z.coerce.number().check(z.gte(-90), z.lte(90))),
  lng: z.optional(z.coerce.number().check(z.gte(-180), z.lte(180))),
})

const feedItemWire = z.object({
  code: z.string(),
  vertical: verticalSchema,
  title: z.string(),
  species: speciesSchema,
  /** «Perra · Pequeña · Negro y canela» — already composed by the server for cards. */
  summary: z.nullable(z.string()),
  place_name: z.string(),
  /** Where to draw it on the feed map: public precision, never a doorstep. */
  point,
  photo_url: z.nullable(z.string()),
  happened_at: timestamp,
  possible_find: z.boolean(),
  sightings_count: z.nullable(z.int().check(z.nonnegative())),
  last_sighting_at: z.nullable(timestamp),
  /** Adoption: «Sin cuota» and the like. Help: «14 personas ayudaron». */
  detail: z.nullable(z.string()),
})

export const feedWire = z.object({
  /** `national` when nothing is open near the viewer (docs/product/00 · Geography). */
  scope: z.enum(['local', 'national']),
  items: z.array(feedItemWire),
})

export type FeedItem = {
  code: string
  vertical: z.infer<typeof verticalSchema>
  title: string
  species: z.infer<typeof speciesSchema>
  summary: string | null
  placeName: string
  point: { lat: number; lng: number }
  photoUrl: string | null
  happenedAt: Date
  possibleFind: boolean
  sightingsCount: number | null
  lastSightingAt: Date | null
  detail: string | null
}

export type Feed = { scope: 'local' | 'national'; items: FeedItem[] }

export function parseFeed(raw: unknown): Feed {
  const wire = feedWire.parse(raw)
  return {
    scope: wire.scope,
    items: wire.items.map((item) => ({
      code: item.code,
      vertical: item.vertical,
      title: item.title,
      species: item.species,
      summary: item.summary,
      placeName: item.place_name,
      point: item.point,
      photoUrl: item.photo_url,
      happenedAt: new Date(item.happened_at),
      possibleFind: item.possible_find,
      sightingsCount: item.sightings_count,
      lastSightingAt: item.last_sighting_at ? new Date(item.last_sighting_at) : null,
      detail: item.detail,
    })),
  }
}
