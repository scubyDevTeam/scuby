import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
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
