const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export const durations = { MINUTE, HOUR, DAY } as const

/** docs/product/04 · Display rules §1: pins shrink and fade in age bands. */
export type AgeBand = 'under_6h' | 'under_24h' | 'under_3d' | 'older'

export function ageBand(seenAt: Date, now: Date): AgeBand {
  const age = now.getTime() - seenAt.getTime()
  if (age < 6 * HOUR) return 'under_6h'
  if (age < DAY) return 'under_24h'
  if (age < 3 * DAY) return 'under_3d'
  return 'older'
}

/** «hace 2 h» · «hace 3 días» — relative time for UI copy. */
export function formatRelative(then: Date, now: Date): string {
  const age = Math.max(0, now.getTime() - then.getTime())
  if (age < MINUTE) return 'hace un momento'
  if (age < HOUR) return `hace ${Math.floor(age / MINUTE)} min`
  if (age < DAY) return `hace ${Math.floor(age / HOUR)} h`
  const days = Math.floor(age / DAY)
  return days === 1 ? 'hace 1 día' : `hace ${days} días`
}
