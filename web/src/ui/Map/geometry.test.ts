import { describe, expect, it } from 'vitest'
import { boundsOf, circleRing, pinIconName, trajectory } from './geometry'
import type { MapPin } from './types'

const center = { lat: 6.2447, lng: -75.5916 }
const pin = (id: string, order: number, lat: number, lng: number): MapPin => ({
  id,
  point: { lat, lng },
  order,
  band: 'under_24h',
  emphasized: false,
})

describe('map geometry', () => {
  it('draws the area as a closed ring at the given radius', () => {
    const ring = circleRing({ center, radiusM: 200 })
    expect(ring[0]).toEqual(ring.at(-1))
    const north = Math.max(...ring.map(([, lat]) => lat))
    expect((north - center.lat) * 110_574).toBeCloseTo(200, 0)
  })

  it('joins pins in trajectory order whatever order they arrive in', () => {
    const line = trajectory([pin('c', 3, 3, 30), pin('a', 1, 1, 10), pin('b', 2, 2, 20)])
    expect(line).toEqual([
      [10, 1],
      [20, 2],
      [30, 3],
    ])
  })

  it('frames the whole area and every pin', () => {
    const far = pin('far', 1, center.lat + 0.02, center.lng + 0.03)
    const [west, south, east, north] = boundsOf({ center, radiusM: 200 }, [far])
    expect(east).toBeCloseTo(far.point.lng)
    expect(north).toBeCloseTo(far.point.lat)
    expect(west).toBeLessThan(center.lng)
    expect(south).toBeLessThan(center.lat)
  })

  it('gives equal-looking pins the same icon', () => {
    expect(pinIconName({ order: 2, emphasized: false })).toBe(
      pinIconName({ order: 2, emphasized: false }),
    )
    expect(pinIconName({ order: 2, emphasized: true })).not.toBe(
      pinIconName({ order: 2, emphasized: false }),
    )
  })
})
