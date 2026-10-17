// «Mascotas perdidas cerca de mí» (docs/product/08).
import { nearbyAlertsRequest, nearbyAlertsWire } from '../alerts'
import { endpoint } from '../endpoint'

export const getNearbyAlerts = endpoint({
  method: 'GET',
  path: '/me/nearby-alerts',
  summary: 'The zone this account asked to be told about, and whether it is on.',
  auth: 'session',
  response: nearbyAlertsWire,
})

export const setNearbyAlerts = endpoint({
  method: 'POST',
  path: '/me/nearby-alerts',
  summary:
    'Sets the zone and turns the alerts on or off. On needs a `center` (`validation_failed` ' +
    'without one). Off keeps the zone. Answers the whole setting.',
  auth: 'session',
  body: nearbyAlertsRequest,
  response: nearbyAlertsWire,
})
