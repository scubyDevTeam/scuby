import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  type ClaimInput,
  parseClaim,
  parseCreated,
  type ReportInput,
  recoveryClaimBody,
  reportBody,
} from '../contracts/actions'
import { parseConfig } from '../contracts/config'
import * as helpersEndpoints from '../contracts/endpoints/helpers'
import * as readEndpoints from '../contracts/endpoints/read'
import { call } from './http'

/** Country rows and the like: fetched once, they do not change while the app is open. */
export const configQuery = queryOptions({
  queryKey: ['config'],
  queryFn: () => call(readEndpoints.getConfig, {}, parseConfig),
  staleTime: Number.POSITIVE_INFINITY,
})

export function useConfig() {
  return useQuery(configQuery)
}

// «Lo vi» is `sighting-replay.ts`: the one mutation with a persisted retry queue.

/** The claim row is created first; only its answer carries the channel to the owner. */
export function useClaimRecovery(code: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: ClaimInput) =>
      call(
        helpersEndpoints.claimRecovery,
        { params: { code }, body: recoveryClaimBody(input) },
        parseClaim,
      ),
    onSuccess: () => client.invalidateQueries({ queryKey: ['case', code] }),
  })
}

export function useSendReport() {
  return useMutation({
    mutationFn: (input: ReportInput) =>
      call(helpersEndpoints.sendReport, { body: reportBody(input) }, parseCreated),
  })
}
