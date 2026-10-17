// «Mascotas perdidas cerca de mí» (docs/product/08): the zone an account asks to be told about.

/** The radii the design offers: «1 km · 2 km · 5 km». */
export const ALERT_RADII_KM = [1, 2, 5] as const
export type AlertRadiusKm = (typeof ALERT_RADII_KM)[number]
export const DEFAULT_ALERT_RADIUS_KM: AlertRadiusKm = 2

export const isAlertRadius = (value: number): value is AlertRadiusKm =>
  (ALERT_RADII_KM as readonly number[]).includes(value)

/** Alerts need a place: «cerca de dónde» is the whole feature. */
export const canActivateAlerts = (zone: { center: unknown | null }): boolean => zone.center !== null

/** What the map draws around the chosen point. */
export const alertRadiusM = (radiusKm: AlertRadiusKm): number => radiusKm * 1000
