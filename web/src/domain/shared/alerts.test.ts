import { describe, expect, it } from 'vitest'
import {
  ALERT_RADII_KM,
  alertRadiusM,
  canActivateAlerts,
  DEFAULT_ALERT_RADIUS_KM,
  isAlertRadius,
} from './alerts'

describe('nearby alerts — the zone (08)', () => {
  it('offers 1, 2 and 5 km, and starts on 2', () => {
    expect(ALERT_RADII_KM).toEqual([1, 2, 5])
    expect(DEFAULT_ALERT_RADIUS_KM).toBe(2)
    expect(isAlertRadius(5)).toBe(true)
    expect(isAlertRadius(3)).toBe(false)
  })

  it('cannot be turned on without a place', () => {
    expect(canActivateAlerts({ center: null })).toBe(false)
    expect(canActivateAlerts({ center: { lat: 6.2, lng: -75.5 } })).toBe(true)
  })

  it('draws the radius in metres', () => {
    expect(alertRadiusM(2)).toBe(2000)
  })
})
