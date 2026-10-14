import { useMutation, useQueryClient } from '@tanstack/react-query'
import { parseClaim, parseCreated, sightingBody } from '../contracts/actions'
import {
  type MatchInput,
  matchBody,
  type OrphanSightingInput,
  type OwnershipClaimInput,
  orphanSightingBody,
  ownershipClaimBody,
  type PublishFoundInput,
  parseCandidates,
  publishFoundBody,
  type ResolveInput,
  resolveBody,
} from '../contracts/found'
import { parsePublish } from '../contracts/owner'
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

/** Asks for lost pets this animal could be. Candidates are always confirmed by a person. */
export function useMatchAnimal() {
  return useMutation({
    mutationFn: (input: MatchInput) => apiPost('/matches', matchBody(input), parseCandidates),
  })
}

export function usePublishFound() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: PublishFoundInput) =>
      apiPost('/found-cases', publishFoundBody(input), parsePublish),
    onSuccess: (result) => {
      if (result.kind === 'published') client.invalidateQueries()
    },
  })
}

/** A witness report: attached to the case the witness recognised, or kept as an orphan. */
export function useReportWitness() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ caseCode, ...input }: OrphanSightingInput & { caseCode: string | null }) =>
      caseCode
        ? apiPost(
            `${casePath(caseCode)}/sightings`,
            sightingBody({
              point: input.point,
              seenAt: input.seenAt,
              note: input.note,
              contactPhone: input.contactPhone,
            }),
            parseCreated,
          )
        : apiPost('/sightings', orphanSightingBody(input), parseCreated),
    onSuccess: () => client.invalidateQueries({ queryKey: ['case'] }),
  })
}
