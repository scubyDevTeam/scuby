import { describe, expect, it } from 'vitest'
import {
  boundsOf,
  circleRing,
  clusterDiameter,
  clusterIconName,
  markersBounds,
  markersByTone,
  markersKey,
  parseClusterIcon,
  pinIconName,
  trajectory,
} from './geometry'
import type { MapMarker, MapPin } from './types'

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

const marker = (id: string, tone: MapMarker['tone'], lat = center.lat, lng = center.lng) => ({
  id,
  tone,
  point: { lat, lng },
})

describe('feed map clustering', () => {
  it('splits the cases by vertical, so each group keeps one colour', () => {
    const byTone = markersByTone([
      marker('a', 'lost'),
      marker('b', 'found'),
      marker('c', 'lost'),
      marker('d', 'help'),
    ])
    expect(byTone.lost.features.map((f) => f.properties?.id)).toEqual(['a', 'c'])
    expect(byTone.found.features).toHaveLength(1)
    expect(byTone.adoption.features).toHaveLength(0)
    expect(byTone.help.features[0]?.geometry).toEqual({
      type: 'Point',
      coordinates: [center.lng, center.lat],
    })
  })

  it('handles the 300 pins of the design in one pass', () => {
    const tones = ['lost', 'found', 'adoption', 'help'] as const
    const many = Array.from({ length: 300 }, (_, i) =>
      marker(`c${i}`, tones[i % 4]!, center.lat + i / 10_000, center.lng - i / 10_000),
    )
    const byTone = markersByTone(many)
    expect(Object.values(byTone).reduce((sum, c) => sum + c.features.length, 0)).toBe(300)
    const [west, south, east, north] = markersBounds(many)
    expect(south).toBeCloseTo(center.lat)
    expect(north).toBeCloseTo(center.lat + 299 / 10_000)
    expect(east).toBeCloseTo(center.lng)
    expect(west).toBeCloseTo(center.lng - 299 / 10_000)
  })

  it('keys the markers by content: a re-render with the same cases does not refit the map', () => {
    expect(markersKey([marker('a', 'lost')])).toBe(markersKey([marker('a', 'lost')]))
    expect(markersKey([marker('a', 'lost')])).not.toBe(
      markersKey([marker('a', 'lost', center.lat + 0.01)]),
    )
  })

  it('names a group’s image by its colour and count, and reads it back', () => {
    const name = clusterIconName('lost', '86')
    expect(name).toBe('cluster-lost-86')
    expect(parseClusterIcon(name)).toEqual({ tone: 'lost', count: '86' })
    expect(parseClusterIcon(clusterIconName('adoption', '1.2k'))).toEqual({
      tone: 'adoption',
      count: '1.2k',
    })
    expect(parseClusterIcon('pin-2-strong')).toBeNull()
  })

  it('draws groups in three sizes', () => {
    expect(clusterDiameter('7')).toBeLessThan(clusterDiameter('41'))
    expect(clusterDiameter('41')).toBeLessThan(clusterDiameter('124'))
    expect(clusterDiameter('2.1k')).toBe(clusterDiameter('124'))
  })
})
