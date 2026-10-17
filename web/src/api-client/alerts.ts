// «Mascotas perdidas cerca de mí» (docs/product/08): the profile's zone.
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type NearbyAlerts, parseNearbyAlerts } from '../contracts/alerts'
import * as alertsEndpoints from '../contracts/endpoints/alerts'
import { call } from './http'

const KEY = ['me', 'nearby-alerts'] as const

export const nearbyAlertsQuery = queryOptions({
  queryKey: KEY,
  queryFn: () => call(alertsEndpoints.getNearbyAlerts, {}, parseNearbyAlerts),
})

export const useNearbyAlerts = () => useQuery(nearbyAlertsQuery)

export function useSetNearbyAlerts() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      enabled: boolean
      center: NearbyAlerts['center']
      radiusKm: 1 | 2 | 5
    }) =>
      call(
        alertsEndpoints.setNearbyAlerts,
        { body: { enabled: input.enabled, center: input.center, radius_km: input.radiusKm } },
        parseNearbyAlerts,
      ),
    onSuccess: (alerts) => client.setQueryData(KEY, alerts),
  })
}
