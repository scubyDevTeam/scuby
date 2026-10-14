import { useMutation, useQueryClient } from '@tanstack/react-query'
import { parseClaim, parseCreated } from '../contracts/actions'
import {
  type OwnershipClaimInput,
  ownershipClaimBody,
  type ResolveInput,
  resolveBody,
} from '../contracts/found'
import { apiPost } from './http'

const casePath = (code: string) => `/cases/${encodeURIComponent(code)}`

/** «Es mío»: the claim row first; its answer carries the channel to the custodian. */
export function useClaimOwnership(code: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: OwnershipClaimInput) =>
      apiPost(`${casePath(code)}/ownership-claims`, ownershipClaimBody(input), parseClaim),
    onSuccess: () => client.invalidateQueries({ queryKey: ['case', code] }),
  })
}

export function useAnswerOwnershipClaim(code: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: { claimId: string; status: 'confirmed' | 'dismissed' }) =>
      apiPost(
        `${casePath(code)}/ownership-claims/${encodeURIComponent(input.claimId)}`,
        { status: input.status },
        parseCreated,
      ),
    onSuccess: () => client.invalidateQueries({ queryKey: ['case', code] }),
  })
}

/** Every way a custodian ends — or keeps — a found case. Changes the feed and their lists too. */
export function useResolveFound(code: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: ResolveInput) =>
      apiPost(`${casePath(code)}/resolve`, resolveBody(input), parseCreated),
    onSuccess: () => client.invalidateQueries(),
  })
}
