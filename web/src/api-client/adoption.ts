import { useMutation, useQueryClient } from '@tanstack/react-query'
import { parseCreated } from '../contracts/actions'
import {
  type InterestInput,
  interestBody,
  type PublishAdoptionInput,
  parseInterest,
  publishAdoptionBody,
  type WithdrawReason,
} from '../contracts/adoption'
import * as adoptionEndpoints from '../contracts/endpoints/adoption'
import * as lostEndpoints from '../contracts/endpoints/lost'
import { parsePublish } from '../contracts/owner'
import { call } from './http'

/** Publishing (or converting a found case) changes the feed, the lister's lists and the phone. */
export function usePublishAdoption() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: PublishAdoptionInput) =>
      call(adoptionEndpoints.publishAdoption, { body: publishAdoptionBody(input) }, parsePublish),
    onSuccess: (result) => {
      if (result.kind === 'published') client.invalidateQueries()
    },
  })
}

/** «Me interesa»: the intro row first; its answer carries the channels the lister enabled. */
export function useExpressInterest(code: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: InterestInput) =>
      call(
        adoptionEndpoints.expressInterest,
        { params: { code }, body: interestBody(input) },
        parseInterest,
      ),
    onSuccess: (result) => {
      // The session's verified number changed too, when the SMS code was sent.
      if (result.kind === 'sent') client.invalidateQueries()
    },
  })
}

export function useWithdrawInterest(code: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (interestId: string) =>
      call(adoptionEndpoints.withdrawInterest, { params: { code, interestId } }, parseCreated),
    onSuccess: () => client.invalidateQueries({ queryKey: ['case', code] }),
  })
}

/** Every lister move changes the listing, and with it the feed and their own lists. */
function useListerAction<T>(action: (input: T) => Promise<unknown>) {
  const client = useQueryClient()
  return useMutation({ mutationFn: action, onSuccess: () => client.invalidateQueries() })
}

export const useAnswerInterest = (code: string) =>
  useListerAction((input: { interestId: string; status: 'chosen' | 'declined' | 'open' }) =>
    call(
      adoptionEndpoints.answerInterest,
      { params: { code, interestId: input.interestId }, body: { status: input.status } },
      parseCreated,
    ),
  )

/** `interestId` null: adopted off the platform. */
export const useRecordAdoption = (code: string) =>
  useListerAction((interestId: string | null) =>
    call(
      adoptionEndpoints.recordAdoption,
      { params: { code }, body: { interest_id: interestId } },
      parseCreated,
    ),
  )

export const useWithdrawAdoption = (code: string) =>
  useListerAction((resolution: WithdrawReason) =>
    call(
      adoptionEndpoints.withdrawAdoption,
      { params: { code }, body: { resolution } },
      parseCreated,
    ),
  )

/** «Sigue disponible» — the one-tap answer to the listing's check-in. */
export const useStillAvailable = (code: string) =>
  useListerAction((checkinId: string) =>
    call(
      lostEndpoints.answerCheckin,
      { params: { code, checkinId }, body: { response: 'still_available' } },
      parseCreated,
    ),
  )
