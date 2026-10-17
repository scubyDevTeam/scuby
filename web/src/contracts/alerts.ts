// «Mascotas perdidas cerca de mí» (docs/product/08): the zone around a point, set in the profile.
import * as z from 'zod/mini'
import { point } from './primitives'

export const radiusKmSchema = z.union([z.literal(1), z.literal(2), z.literal(5)])

export const nearbyAlertsWire = z.object({
  enabled: z.boolean(),
  /** Null until a zone was confirmed. */
  center: z.nullable(point),
  radius_km: radiusKmSchema,
  /** The neighbourhood the point falls in, composed by the server in the request's language. */
  place_name: z.nullable(z.string()),
})

/** Turning them on needs a `center`; turning them off keeps the zone for next time. */
export const nearbyAlertsRequest = z.object({
  enabled: z.boolean(),
  center: z.nullable(point),
  radius_km: radiusKmSchema,
})

export type NearbyAlerts = {
  enabled: boolean
  center: { lat: number; lng: number } | null
  radiusKm: 1 | 2 | 5
  placeName: string | null
}

export function parseNearbyAlerts(raw: unknown): NearbyAlerts {
  const wire = nearbyAlertsWire.parse(raw)
  return {
    enabled: wire.enabled,
    center: wire.center,
    radiusKm: wire.radius_km,
    placeName: wire.place_name,
  }
}
