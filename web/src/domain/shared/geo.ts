export type Point = { lat: number; lng: number }

export type Area = { center: Point; radiusM: number }

const EARTH_RADIUS_M = 6_371_000
const toRad = (deg: number) => (deg * Math.PI) / 180

/** Great-circle distance in metres. */
export function distanceM(a: Point, b: Point): number {
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h))
}

/** docs/product/04 · Location precision: the public never sees a last-seen circle under 200 m. */
export const PUBLIC_RADIUS_FLOOR_M = 200

/** Applied at render, never stored. The center is untouched: every computation uses it. */
export function publicArea(area: Area): Area {
  return { center: area.center, radiusM: Math.max(area.radiusM, PUBLIC_RADIUS_FLOOR_M) }
}
