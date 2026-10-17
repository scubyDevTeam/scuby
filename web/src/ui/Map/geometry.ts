// GeoJSON for the GL layers. Pure functions, so the drawing rules are testable without a map.
import type { FeatureCollection } from 'geojson'
import type { MapArea, MapMarker, MapPin, MapPoint, MapTone } from './types'

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

export const TONES = ['lost', 'found', 'adoption', 'help'] as const

/**
 * The feed map's markers, one collection per vertical: each clusters on its own, so a group keeps
 * its colour and «86» reads as 86 lost pets, not a mix.
 */
export function markersByTone(markers: readonly MapMarker[]): Record<MapTone, FeatureCollection> {
  const byTone = Object.fromEntries(
    TONES.map((tone) => [tone, { type: 'FeatureCollection', features: [] }]),
  ) as unknown as Record<MapTone, FeatureCollection>
  for (const marker of markers) {
    byTone[marker.tone].features.push({
      type: 'Feature',
      properties: { id: marker.id },
      geometry: { type: 'Point', coordinates: [marker.point.lng, marker.point.lat] },
    })
  }
  return byTone
}

/** Same markers, same key: a re-render that changes nothing must not refit the map. */
export const markersKey = (markers: readonly MapMarker[]) =>
  markers.map((m) => `${m.id}@${m.point.lat},${m.point.lng}`).join('|')

/** Every look of a group is an image drawn on demand: `cluster-lost-86`. No glyphs needed. */
export const clusterIconName = (tone: MapTone, count: string) => `cluster-${tone}-${count}`

export function parseClusterIcon(name: string): { tone: MapTone; count: string } | null {
  const match = /^cluster-(lost|found|adoption|help)-(.+)$/.exec(name)
  return match ? { tone: match[1] as MapTone, count: match[2]! } : null
}

/** Bigger groups draw bigger, in three steps, so 300 pins read as a few sizes, not 300 sizes. */
export const clusterDiameter = (count: string) =>
  count.length >= 3 || count.endsWith('k') ? 72 : count.length === 2 ? 60 : 50

/** The box that frames every marker: [west, south, east, north]. */
export function markersBounds(markers: readonly MapMarker[]): [number, number, number, number] {
  const lngs = markers.map((m) => m.point.lng)
  const lats = markers.map((m) => m.point.lat)
  return [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)]
}
