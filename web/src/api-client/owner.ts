import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { parseCreated } from '../contracts/actions'
import { api } from '../contracts/api'
import {
  type CheckinAnswer,
  type LostAttribution,
  type LostCancelReason,
  type PublishLostInput,
  parseMyCases,
  parseNotifications,
  parsePets,
  parsePublish,
  parseUpload,
  publishLostBody,
} from '../contracts/owner'
import { parseNothing } from '../contracts/session'
import { call } from './http'

export const myPetsQuery = queryOptions({
  queryKey: ['me', 'pets'],
  queryFn: () => call(api.listMyPets, {}, parsePets),
})

export const useMyPets = () => useQuery(myPetsQuery)

export const myCasesQuery = queryOptions({
  queryKey: ['me', 'cases'],
  queryFn: () => call(api.listMyCases, {}, parseMyCases),
})

export const useMyCases = () => useQuery(myCasesQuery)

/** One prepared photo → its URL. */
export function useUploadPhoto() {
  return useMutation({
    mutationFn: (photo: Blob) => call(api.uploadPhoto, { body: photo }, parseUpload),
  })
}

/** Publishing changes the feed, the owner's lists and the verified phone on the session. */
export function usePublishLost() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: PublishLostInput) =>
      call(api.publishLost, { body: publishLostBody(input) }, parsePublish),
    onSuccess: (result) => {
      if (result.kind === 'published') client.invalidateQueries()
    },
  })
}

/** Every owner action changes the case, and with it the feed and the owner's lists. */
function useOwnerAction<T>(action: (input: T) => Promise<unknown>) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: action,
    onSuccess: () => client.invalidateQueries(),
  })
}

/** Only the owner closes a case as reunited (docs/product/04). */
export const useReunite = (code: string) =>
  useOwnerAction((input: { attribution: LostAttribution }) =>
    call(
      api.reuniteCase,
      { params: { code }, body: { resolution_attribution: input.attribution } },
      parseCreated,
    ),
  )

export const useCancelCase = (code: string) =>
  useOwnerAction((input: { reason: LostCancelReason }) =>
    call(api.cancelCase, { params: { code }, body: { resolution: input.reason } }, parseCreated),
  )

export const useReopenCase = (code: string) =>
  useOwnerAction(() => call(api.reopenCase, { params: { code } }, parseCreated))

export const useAnswerClaim = (code: string) =>
  useOwnerAction((input: { claimId: string; status: 'confirmed' | 'dismissed' }) =>
    call(
      api.answerRecoveryClaim,
      { params: { code, claimId: input.claimId }, body: { status: input.status } },
      parseCreated,
    ),
  )

/** Star a pin, or take it off the public map. Counts as an owner interaction (04). */
export const useModerateSighting = (code: string) =>
  useOwnerAction((input: { sightingId: string; highlighted?: boolean; hidden?: boolean }) =>
    call(
      api.moderateSighting,
      {
        params: { code, sightingId: input.sightingId },
        body: { highlighted: input.highlighted, hidden: input.hidden },
      },
      parseCreated,
    ),
  )

/** `attribution` goes with `reunited`, `reason` with `delete` (04 · The follow-up loop). */
export const useAnswerCheckin = (code: string) =>
  useOwnerAction(
    (input: {
      checkinId: string
      response: CheckinAnswer
      attribution?: LostAttribution
      reason?: LostCancelReason
    }) =>
      call(
        api.answerCheckin,
        {
          params: { code, checkinId: input.checkinId },
          body: {
            response: input.response,
            resolution_attribution: input.attribution ?? null,
            resolution: input.reason ?? null,
          },
        },
        parseCreated,
      ),
  )

export const notificationsQuery = queryOptions({
  queryKey: ['me', 'notifications'],
  queryFn: () => call(api.listNotifications, {}, parseNotifications),
})

export const useNotifications = () => useQuery(notificationsQuery)

/** The ones named, or all of them. */
export function useReadNotifications() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (ids: string[] | null) =>
      call(api.readNotifications, { body: { ids } }, parseNothing),
    onSuccess: () => client.invalidateQueries({ queryKey: ['me', 'notifications'] }),
  })
}
