// GeoJSON for the GL layers. Pure functions, so the drawing rules are testable without a map.
import type { MapArea, MapPin, MapPoint } from './types'

type Position = [lng: number, lat: number]

const M_PER_DEG_LAT = 110_574
const mPerDegLng = (lat: number) => 111_320 * Math.cos((lat * Math.PI) / 180)

/** A circle of `radiusM` metres as a closed ring — GL has no geographic circle of its own. */
export function circleRing(area: MapArea, steps = 64): Position[] {
  const { center, radiusM } = area
  const ring: Position[] = []
  for (let i = 0; i <= steps; i++) {
    const angle = (i / steps) * 2 * Math.PI
    ring.push([
      center.lng + (radiusM * Math.cos(angle)) / mPerDegLng(center.lat),
      center.lat + (radiusM * Math.sin(angle)) / M_PER_DEG_LAT,
    ])
  }
  return ring
}

/** Pins in trajectory order, oldest first. */
export function trajectory(pins: readonly MapPin[]): Position[] {
  return [...pins].sort((a, b) => a.order - b.order).map((pin) => [pin.point.lng, pin.point.lat])
}

/** The box that shows the whole area and every pin: [west, south, east, north]. */
export function boundsOf(area: MapArea, pins: readonly MapPin[]): [number, number, number, number] {
  const ring = circleRing(area, 4)
  const points: MapPoint[] = [
    ...ring.map(([lng, lat]) => ({ lng, lat })),
    ...pins.map((p) => p.point),
  ]
  const lngs = points.map((p) => p.lng)
  const lats = points.map((p) => p.lat)
  return [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)]
}

/** One icon per distinct look, so equal pins share an image. */
export function pinIconName(pin: Pick<MapPin, 'order' | 'emphasized'>): string {
  return `pin-${pin.order}-${pin.emphasized ? 'strong' : 'soft'}`
}

export const bandOpacity = { under_6h: 1, under_24h: 0.85, under_3d: 0.65, older: 0.5 } as const
