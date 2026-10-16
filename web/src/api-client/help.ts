import { useMutation, useQueryClient } from '@tanstack/react-query'
import { parseCreated } from '../contracts/actions'
import * as helpEndpoints from '../contracts/endpoints/help'
import * as lostEndpoints from '../contracts/endpoints/lost'
import {
  type CloseHelpReason,
  type PledgeInput,
  type PublishHelpInput,
  parsePledge,
  pledgeBody,
  publishHelpBody,
} from '../contracts/help'
import { parsePublish } from '../contracts/owner'
import { call } from './http'

/** Publishing changes the feed, the beneficiary's lists and, with the SMS code, the phone. */
export function usePublishHelp() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: PublishHelpInput) =>
      call(helpEndpoints.publishHelp, { body: publishHelpBody(input) }, parsePublish),
    onSuccess: (result) => {
      if (result.kind === 'published') client.invalidateQueries()
    },
  })
}

/** «Yo ayudo»: the pledge row first; its answer carries the channel to the beneficiary. */
export function usePledge(code: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: PledgeInput) =>
      call(helpEndpoints.pledgeHelp, { params: { code }, body: pledgeBody(input) }, parsePledge),
    onSuccess: (result) => {
      // The request's progress changed, and so did the session's verified number with the code.
      if (result.kind === 'sent') client.invalidateQueries()
    },
  })
}

export function useWithdrawPledge(code: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (pledgeId: string) =>
      call(helpEndpoints.withdrawPledge, { params: { code, pledgeId } }, parseCreated),
    onSuccess: () => client.invalidateQueries({ queryKey: ['case', code] }),
  })
}

/** Every beneficiary move changes the request, and with it the feed and their own lists. */
function useBeneficiaryAction<T>(action: (input: T) => Promise<unknown>) {
  const client = useQueryClient()
  return useMutation({ mutationFn: action, onSuccess: () => client.invalidateQueries() })
}

export const useAnswerPledge = (code: string) =>
  useBeneficiaryAction((input: { pledgeId: string; status: 'confirmed' | 'declined' }) =>
    call(
      helpEndpoints.answerPledge,
      { params: { code, pledgeId: input.pledgeId }, body: { status: input.status } },
      parseCreated,
    ),
  )

export const useCoverNeed = (code: string) =>
  useBeneficiaryAction((needId: string) =>
    call(helpEndpoints.coverNeed, { params: { code, needId } }, parseCreated),
  )

export const useCloseHelp = (code: string) =>
  useBeneficiaryAction((resolution: CloseHelpReason) =>
    call(helpEndpoints.closeHelp, { params: { code }, body: { resolution } }, parseCreated),
  )

/** «Sí, sigue» — the one-tap answer to the request's check-in. */
export const useStillNeeded = (code: string) =>
  useBeneficiaryAction((checkinId: string) =>
    call(
      lostEndpoints.answerCheckin,
      { params: { code, checkinId }, body: { response: 'still_needed' } },
      parseCreated,
    ),
  )
