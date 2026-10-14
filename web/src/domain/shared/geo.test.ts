import { describe, expect, it } from 'vitest'
import { distanceM, publicArea } from './geo'

const laureles = { lat: 6.2447, lng: -75.5916 }

describe('04 · Location precision — the 200 m public floor', () => {
  it.each([
    [50, 200],
    [100, 200],
    [200, 200],
    [300, 300],
    [1000, 1000],
  ])('a %i m circle renders as %i m', (stored, shown) => {
    expect(publicArea({ center: laureles, radiusM: stored }).radiusM).toBe(shown)
  })

  it('never moves the center', () => {
    expect(publicArea({ center: laureles, radiusM: 50 }).center).toEqual(laureles)
  })
})

describe('distance', () => {
  it('measures about 111 km per degree of latitude', () => {
    const d = distanceM({ lat: 6, lng: -75 }, { lat: 7, lng: -75 })
    expect(d).toBeGreaterThan(110_000)
    expect(d).toBeLessThan(112_000)
  })
})
