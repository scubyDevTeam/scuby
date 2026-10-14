import { useMutation, useQueryClient } from '@tanstack/react-query'
import { parseClaim, parseCreated, sightingBody } from '../contracts/actions'
import { api } from '../contracts/api'
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
import { call } from './http'

/** «Es mío»: the claim row first; its answer carries the channel to the custodian. */
export function useClaimOwnership(code: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: OwnershipClaimInput) =>
      call(api.claimOwnership, { params: { code }, body: ownershipClaimBody(input) }, parseClaim),
    onSuccess: () => client.invalidateQueries({ queryKey: ['case', code] }),
  })
}

export function useAnswerOwnershipClaim(code: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: { claimId: string; status: 'confirmed' | 'dismissed' }) =>
      call(
        api.answerOwnershipClaim,
        { params: { code, claimId: input.claimId }, body: { status: input.status } },
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
      call(api.resolveFound, { params: { code }, body: resolveBody(input) }, parseCreated),
    onSuccess: () => client.invalidateQueries(),
  })
}

/** Asks for lost pets this animal could be. Candidates are always confirmed by a person. */
export function useMatchAnimal() {
  return useMutation({
    mutationFn: (input: MatchInput) =>
      call(api.matchAnimal, { body: matchBody(input) }, parseCandidates),
  })
}

export function usePublishFound() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: PublishFoundInput) =>
      call(api.publishFound, { body: publishFoundBody(input) }, parsePublish),
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
        ? call(
            api.reportSighting,
            {
              params: { code: caseCode },
              body: sightingBody({
                point: input.point,
                seenAt: input.seenAt,
                note: input.note,
                photoUrls: input.photoUrls,
                contactPhone: input.contactPhone,
              }),
            },
            parseCreated,
          )
        : call(api.reportOrphanSighting, { body: orphanSightingBody(input) }, parseCreated),
    onSuccess: () => client.invalidateQueries({ queryKey: ['case'] }),
  })
}
