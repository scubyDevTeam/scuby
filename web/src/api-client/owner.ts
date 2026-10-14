import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { parseCreated } from '../contracts/actions'
import {
  type PublishLostInput,
  parseMyCases,
  parsePets,
  parsePublish,
  parseUpload,
  publishLostBody,
} from '../contracts/owner'
import { apiGet, apiPost, apiUpload } from './http'

export const myPetsQuery = queryOptions({
  queryKey: ['me', 'pets'],
  queryFn: () => apiGet('/me/pets', parsePets),
})

export const useMyPets = () => useQuery(myPetsQuery)

export const myCasesQuery = queryOptions({
  queryKey: ['me', 'cases'],
  queryFn: () => apiGet('/me/cases', parseMyCases),
})

export const useMyCases = () => useQuery(myCasesQuery)

/** One prepared photo → its URL. */
export function useUploadPhoto() {
  return useMutation({ mutationFn: (photo: Blob) => apiUpload('/uploads', photo, parseUpload) })
}

/** Publishing changes the feed, the owner's lists and the verified phone on the session. */
export function usePublishLost() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: PublishLostInput) =>
      apiPost('/lost-cases', publishLostBody(input), parsePublish),
    onSuccess: (result) => {
      if (result.kind === 'published') client.invalidateQueries()
    },
  })
}

const ownerPath = (code: string) => `/cases/${encodeURIComponent(code)}`
const done = (raw: unknown) => parseCreated(raw)

/** Every owner action changes the case, and with it the feed and the owner's lists. */
function useOwnerAction<T>(path: (input: T) => string, body: (input: T) => unknown) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: T) => apiPost(path(input), body(input), done),
    onSuccess: () => client.invalidateQueries(),
  })
}

/** Only the owner closes a case as reunited (docs/product/04). */
export const useReunite = (code: string) =>
  useOwnerAction<{ attribution: string }>(
    () => `${ownerPath(code)}/reunite`,
    (input) => ({ resolution_attribution: input.attribution }),
  )

export const useCancelCase = (code: string) =>
  useOwnerAction<{ reason: string }>(
    () => `${ownerPath(code)}/cancel`,
    (input) => ({ resolution: input.reason }),
  )

export const useReopenCase = (code: string) =>
  useOwnerAction<void>(
    () => `${ownerPath(code)}/reopen`,
    () => ({}),
  )

export const useAnswerClaim = (code: string) =>
  useOwnerAction<{ claimId: string; status: 'confirmed' | 'dismissed' }>(
    (input) => `${ownerPath(code)}/claims/${encodeURIComponent(input.claimId)}`,
    (input) => ({ status: input.status }),
  )
