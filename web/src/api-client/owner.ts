import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { parseCreated } from '../contracts/actions'
import * as helpersEndpoints from '../contracts/endpoints/helpers'
import * as lostEndpoints from '../contracts/endpoints/lost'
import {
  type CheckinAnswer,
  type EditLostInput,
  editLostBody,
  type LostAttribution,
  type LostCancelReason,
  type PublishLostInput,
  parseMyCases,
  parsePets,
  parsePublish,
  parseUpload,
  publishLostBody,
  type UploadPurpose,
  uploadBody,
} from '../contracts/owner'
import { parseNothing } from '../contracts/session'
import { ApiError, call } from './http'

export type { UploadPurpose }

export const myPetsQuery = queryOptions({
  queryKey: ['me', 'pets'],
  queryFn: () => call(lostEndpoints.listMyPets, {}, parsePets),
})

export const useMyPets = () => useQuery(myPetsQuery)

export const myCasesQuery = queryOptions({
  queryKey: ['me', 'cases'],
  queryFn: () => call(lostEndpoints.listMyCases, {}, parseMyCases),
})

export const useMyCases = () => useQuery(myCasesQuery)

/**
 * One prepared photo → its URL (docs/eng/api.md · Uploads): ask for a slot signed with the photo's
 * hash, send the bytes to it, answer the URL the slot declared. A photo already stored has no slot
 * to send to. The bytes go to storage, not to the API: no cookie, no `Accept-Language`.
 */
export function useUploadPhoto(purpose: UploadPurpose) {
  return useMutation({
    mutationFn: async ({ photo, sha256 }: { photo: Blob; sha256: string }) => {
      const slot = await call(
        helpersEndpoints.uploadPhoto,
        { body: uploadBody({ purpose, sha256, bytes: photo.size }) },
        parseUpload,
      )
      if (slot.target) {
        let response: Response
        try {
          response = await fetch(new URL(slot.target.url), {
            method: 'PUT',
            headers: slot.target.headers,
            body: photo,
          })
        } catch {
          throw new ApiError('network')
        }
        if (!response.ok) throw new ApiError('unexpected_response', response.status)
      }
      return slot.url
    },
  })
}

/** Publishing changes the feed, the owner's lists and the verified phone on the session. */
export function usePublishLost() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: PublishLostInput) =>
      call(lostEndpoints.publishLost, { body: publishLostBody(input) }, parsePublish),
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
      lostEndpoints.reuniteCase,
      { params: { code }, body: { resolution_attribution: input.attribution } },
      parseCreated,
    ),
  )

export const useCancelCase = (code: string) =>
  useOwnerAction((input: { reason: LostCancelReason }) =>
    call(
      lostEndpoints.cancelCase,
      { params: { code }, body: { resolution: input.reason } },
      parseCreated,
    ),
  )

export const useEditLost = (code: string) =>
  useOwnerAction((input: EditLostInput) =>
    call(lostEndpoints.editLost, { params: { code }, body: editLostBody(input) }, parseNothing),
  )

export const useReopenCase = (code: string) =>
  useOwnerAction(() => call(lostEndpoints.reopenCase, { params: { code } }, parseCreated))

export const useAnswerClaim = (code: string) =>
  useOwnerAction((input: { claimId: string; status: 'confirmed' | 'dismissed' }) =>
    call(
      lostEndpoints.answerRecoveryClaim,
      { params: { code, claimId: input.claimId }, body: { status: input.status } },
      parseCreated,
    ),
  )

/** Star a pin, or take it off the public map. Counts as an owner interaction (04). */
export const useModerateSighting = (code: string) =>
  useOwnerAction((input: { sightingId: string; highlighted?: boolean; hidden?: boolean }) =>
    call(
      lostEndpoints.moderateSighting,
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
        lostEndpoints.answerCheckin,
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
