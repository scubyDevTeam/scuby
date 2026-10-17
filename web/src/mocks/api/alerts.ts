// «Mascotas perdidas cerca de mí» (docs/product/08): the zone, set in the profile.
import { api } from '../../contracts/api'
import type { PersonRow } from '../db'
import { fail, route } from '../route'
import { placeName } from '../rules'

function view(user: PersonRow) {
  const alerts = user.nearby_alerts ?? { enabled: false, center: null, radius_km: 2 as const }
  return {
    enabled: alerts.enabled,
    center: alerts.center,
    radius_km: alerts.radius_km,
    place_name: alerts.center ? placeName(alerts.center) : null,
  }
}

export const alerts = [
  route(api.getNearbyAlerts, ({ user }) => view(user)),

  route(api.setNearbyAlerts, ({ user, body }) => {
    // «Cerca de dónde» is the whole feature: on needs a place.
    if (body.enabled && !body.center) fail('validation_failed')
    user.nearby_alerts = { enabled: body.enabled, center: body.center, radius_km: body.radius_km }
    return view(user)
  }),
]
