// docs/product/04 · `sighting`: validation pre-checks and display rules.
import { distanceM, type Point } from '../shared/geo'
import { type AgeBand, ageBand, durations } from '../shared/time'

export const MAX_SIGHTING_DISTANCE_M = 30_000
export const SEEN_BEFORE_CASE_TOLERANCE_MS = 24 * durations.HOUR

export type SightingDraft = { point: Point; seenAt: Date }
export type SightingContext = { lastSeenPoint: Point; lastSeenAt: Date; petName: string }

export type SightingError = 'too_far' | 'in_the_future' | 'before_the_case'

/** Pre-checks for instant feedback; the server runs the same ones and is the one that decides. */
export function validateSighting(
  draft: SightingDraft,
  context: SightingContext,
  now: Date,
): SightingError[] {
  const errors: SightingError[] = []
  if (distanceM(draft.point, context.lastSeenPoint) > MAX_SIGHTING_DISTANCE_M)
    errors.push('too_far')
  if (draft.seenAt.getTime() > now.getTime()) errors.push('in_the_future')
  if (draft.seenAt.getTime() < context.lastSeenAt.getTime() - SEEN_BEFORE_CASE_TOLERANCE_MS) {
    errors.push('before_the_case')
  }
  return errors
}

export function sightingErrorCopy(error: SightingError, petName: string): string {
  switch (error) {
    case 'too_far':
      return `Ese punto está muy lejos del último lugar donde se vio a ${petName}`
    case 'in_the_future':
      return 'La hora no puede ser en el futuro'
    case 'before_the_case':
      return `${petName} se perdió después de esa hora`
  }
}

export type SightingLike = { id: string; point: Point; seenAt: Date; highlightedByOwner: boolean }

export type PlacedSighting<T extends SightingLike> = T & {
  /** ①②③ from the oldest. */
  order: number
  band: AgeBand
  /** The newest pin, or one the owner starred: drawn full size whatever its age. */
  emphasized: boolean
  isLatest: boolean
  distanceFromLastSeenM: number
}

/** Trajectory order: by `seenAt`, oldest first, so a late report lands in its place, not on top. */
export function placeSightings<T extends SightingLike>(
  sightings: readonly T[],
  lastSeenPoint: Point,
  now: Date,
): PlacedSighting<T>[] {
  const ordered = [...sightings].sort((a, b) => a.seenAt.getTime() - b.seenAt.getTime())
  return ordered.map((sighting, index) => {
    const isLatest = index === ordered.length - 1
    return {
      ...sighting,
      order: index + 1,
      band: ageBand(sighting.seenAt, now),
      emphasized: isLatest || sighting.highlightedByOwner,
      isLatest,
      distanceFromLastSeenM: distanceM(sighting.point, lastSeenPoint),
    }
  })
}
