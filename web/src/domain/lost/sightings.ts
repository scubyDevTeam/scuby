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

/**
 * Display rule 2: the trajectory joins *visible* pins. A pin the owner hid leaves the map and the
 * numbering; only the owner gets it back from the server, and sees it apart, as hidden.
 */
export function splitHidden<T extends { hidden: boolean }>(
  sightings: readonly T[],
): { visible: T[]; hidden: T[] } {
  return {
    visible: sightings.filter((s) => !s.hidden),
    hidden: sightings.filter((s) => s.hidden),
  }
}

/** The owner's hand on a pin (display rules 3 and 5): star it, or take it off the public map. */
export type SightingModeration = 'highlight' | 'unhighlight' | 'hide' | 'unhide'

/** Only the owner moderates. A hidden pin offers only its way back; a visible one, both tools. */
export function moderationOptions(
  sighting: { hidden: boolean; highlightedByOwner: boolean },
  viewer: 'owner' | 'public',
): SightingModeration[] {
  if (viewer !== 'owner') return []
  if (sighting.hidden) return ['unhide']
  return [sighting.highlightedByOwner ? 'unhighlight' : 'highlight', 'hide']
}

/** What each tool changes — only that field is sent. */
export function moderationChange(option: SightingModeration): {
  highlighted?: boolean
  hidden?: boolean
} {
  switch (option) {
    case 'highlight':
      return { highlighted: true }
    case 'unhighlight':
      return { highlighted: false }
    case 'hide':
      return { hidden: true }
    case 'unhide':
      return { hidden: false }
  }
}

/** The pin is the viewer's own and its correction window (`created_at + 15 min`) is still open. */
export const canEditOwn = (
  sighting: { mine: boolean; editableUntil: Date | null },
  now: Date,
): boolean => sighting.mine && sighting.editableUntil !== null && sighting.editableUntil > now

/**
 * The pin a second one would be asked about (04 · Second pin from the same reporter): the
 * reporter's latest visible sighting that can still be corrected. After its window it is part of
 * the record, and a new pin is just a new pin.
 */
export function pinToCorrect<
  T extends { mine: boolean; editableUntil: Date | null; seenAt: Date; hidden: boolean },
>(sightings: readonly T[], now: Date): T | null {
  const own = sightings.filter((s) => !s.hidden && canEditOwn(s, now))
  return own.sort((a, b) => b.seenAt.getTime() - a.seenAt.getTime())[0] ?? null
}
