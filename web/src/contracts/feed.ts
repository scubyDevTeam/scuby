// hand-written until O14 — provisional wire shape.
import { z } from 'zod'
import { speciesSchema, verticalSchema } from './case'

const timestamp = z.iso.datetime({ offset: true })

const feedItemWire = z.object({
  code: z.string(),
  vertical: verticalSchema,
  title: z.string(),
  species: speciesSchema,
  /** «Perra · Pequeña · Negro y canela» — already composed by the server for cards. */
  summary: z.string().nullable(),
  place_name: z.string(),
  /** Where to draw it on the feed map: public precision, never a doorstep. */
  point: z.object({ lat: z.number(), lng: z.number() }),
  photo_url: z.string().nullable(),
  happened_at: timestamp,
  possible_find: z.boolean(),
  sightings_count: z.number().int().nonnegative().nullable(),
  last_sighting_at: timestamp.nullable(),
  /** Adoption: «Sin cuota» and the like. Help: «14 personas ayudaron». */
  detail: z.string().nullable(),
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
