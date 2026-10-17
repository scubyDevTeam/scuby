// «Lo vi» on a weak signal (docs/eng/frontend.md · Risks §6): what a screen needs to show a sighting
// that is waiting to be sent. The machinery that sends, persists and replays is `sighting-replay.ts`.
// Neither is on a case's first load: they come with the form, or when something is waiting
// (`sighting-pending.ts`).
import {
  type Mutation,
  type MutationState,
  useMutationState,
  useQueryClient,
} from '@tanstack/react-query'
import type { SightingBody } from '../contracts/actions'
import type { ErrorCode } from '../contracts/errors'
import { ApiError } from './http'
import { SIGHTING_MUTATION, sightingMutationKey } from './sighting-pending'

export { SIGHTING_MUTATION, sightingMutationKey }

/** What one send carries: plain JSON with its replay key, so it survives a reload as it is. */
export type SightingSend = { code: string; body: SightingBody }

/**
 * Worth sending again: no answer at all, or a server that could not answer (5xx). Anything else is
 * the server's decision — a 422 (the rules) or 429 (the rate limits) on a replay is final.
 */
export function isTransient(error: unknown): boolean {
  return error instanceof ApiError && (error.kind === 'network' || error.kind === 'server')
}

type SendState = Pick<
  MutationState<unknown, unknown, SightingSend>,
  'status' | 'isPaused' | 'failureCount' | 'failureReason'
>

/** Still trying, and not on its first attempt: waiting for a signal, or between retries. */
export function isWaiting(state: SendState): boolean {
  return (
    state.status === 'pending' &&
    (state.isPaused || (state.failureCount > 0 && isTransient(state.failureReason)))
  )
}

// Sends that ever waited, by mutation id: a final error on one of them was not seen in the form
// (it was closed long ago), so the case page has to say it. Written by `sighting-replay.ts`.
const waited = new Set<number>()
export const markWaited = (mutation: Mutation) => void waited.add(mutation.mutationId)

export type QueuedSighting = {
  id: number
  seenAt: string
  note: string | null
  /** Null while it waits; the server's reason once it refused it. */
  rejected: ErrorCode | 'unknown' | null
}

function toQueued(mutation: Mutation): QueuedSighting {
  const { state } = mutation
  const send = state.variables as SightingSend
  const error = state.status === 'error' ? state.error : null
  return {
    id: mutation.mutationId,
    seenAt: send.body.seen_at,
    note: send.body.note,
    rejected: error ? (error instanceof ApiError && error.code) || 'unknown' : null,
  }
}

/** This device's sightings on one case that have not reached the server: local only, never public. */
export function useQueuedSightings(code: string): QueuedSighting[] {
  return useMutationState({
    filters: {
      mutationKey: sightingMutationKey(code),
      exact: true,
      predicate: (mutation) =>
        isWaiting(mutation.state as SendState) ||
        (mutation.state.status === 'error' && waited.has(mutation.mutationId)),
    },
    select: toQueued,
  })
}

/** Takes a refused sighting off the page once the reporter has read why. */
export function useDismissQueued(): (id: number) => void {
  const cache = useQueryClient().getMutationCache()
  return (id) => {
    const mutation = cache.getAll().find((m) => m.mutationId === id)
    if (mutation) cache.remove(mutation)
  }
}
