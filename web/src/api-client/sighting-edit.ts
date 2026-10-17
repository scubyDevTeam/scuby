// Correcting or deleting one's own sighting inside its window (docs/product/04 · Correction window).
// Not queued like a new «Lo vi»: it needs the server's word on the window, so it fails loudly.
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { type SightingCorrection, sightingCorrectionBody } from '../contracts/actions'
import * as helpersEndpoints from '../contracts/endpoints/helpers'
import { parseNothing } from '../contracts/session'
import { call } from './http'

/** The case's map and timeline change with the pin, so the case is fetched again. */
function useRefreshCase(code: string) {
  const client = useQueryClient()
  return () => client.invalidateQueries({ queryKey: ['case', code] })
}

export function useCorrectSighting(code: string) {
  const refresh = useRefreshCase(code)
  return useMutation({
    mutationFn: ({ id, ...input }: SightingCorrection & { id: string }) =>
      call(
        helpersEndpoints.correctSighting,
        { params: { code, sightingId: id }, body: sightingCorrectionBody(input) },
        parseNothing,
      ),
    onSuccess: refresh,
  })
}

export function useDeleteSighting(code: string) {
  const refresh = useRefreshCase(code)
  return useMutation({
    mutationFn: (id: string) =>
      call(helpersEndpoints.deleteSighting, { params: { code, sightingId: id } }, parseNothing),
    onSuccess: refresh,
  })
}
