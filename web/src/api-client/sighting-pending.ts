// The only part of the sighting queue on a case's first load (docs/eng/frontend.md · Budgets): where
// this device keeps unsent «Lo vi», and whether this tab has sent one on a case. The queue itself
// (`sighting-replay.ts`, `sighting-queue.ts`) loads with the form, or when something is waiting.
import { useMutationState } from '@tanstack/react-query'

/** Where this device keeps the sends that have not gone out yet. */
export const SIGHTING_QUEUE_STORAGE = 'sightings.queue'

export const SIGHTING_MUTATION = 'sighting'
export const sightingMutationKey = (code: string) => [SIGHTING_MUTATION, code] as const

/** True once this tab holds a send on the case (restored from the device or made here, in any state). */
export const useHasSightingSends = (code: string): boolean =>
  useMutationState({
    filters: { mutationKey: sightingMutationKey(code), exact: true },
    select: () => true,
  }).length > 0
