import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  type ClaimInput,
  parseClaim,
  parseCreated,
  type ReportInput,
  reportBody,
  type SightingInput,
  sightingBody,
} from '../contracts/actions'
import { parseConfig } from '../contracts/config'
import { apiGet, apiPost } from './http'

/** Country rows and the like: fetched once, they do not change while the app is open. */
export const configQuery = queryOptions({
  queryKey: ['config'],
  queryFn: () => apiGet('/config', parseConfig),
  staleTime: Number.POSITIVE_INFINITY,
})

export function useConfig() {
  return useQuery(configQuery)
}

const casePath = (code: string) => `/cases/${encodeURIComponent(code)}`

/** A new sighting changes the case's map and timeline, so the case is fetched again. */
export function useReportSighting(code: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: SightingInput) =>
      apiPost(`${casePath(code)}/sightings`, sightingBody(input), parseCreated),
    onSuccess: () => client.invalidateQueries({ queryKey: ['case', code] }),
  })
}

/** The claim row is created first; only its answer carries the channel to the owner. */
export function useClaimRecovery(code: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: ClaimInput) =>
      apiPost(`${casePath(code)}/recovery-claims`, { phone: input.phone }, parseClaim),
    onSuccess: () => client.invalidateQueries({ queryKey: ['case', code] }),
  })
}

export function useSendReport() {
  return useMutation({
    mutationFn: (input: ReportInput) => apiPost('/reports', reportBody(input), parseCreated),
  })
}
