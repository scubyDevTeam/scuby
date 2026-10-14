import { describe, expect, it } from 'vitest'
import { ageBand, durations } from './time'

const now = new Date('2026-10-04T12:00:00Z')
const ago = (ms: number) => new Date(now.getTime() - ms)

describe('04 · Display rules §1 — age bands', () => {
  it.each([
    [2 * durations.HOUR, 'under_6h'],
    [6 * durations.HOUR, 'under_24h'],
    [17 * durations.HOUR, 'under_24h'],
    [durations.DAY, 'under_3d'],
    [2 * durations.DAY, 'under_3d'],
    [3 * durations.DAY, 'older'],
  ] as const)('a pin seen %i ms ago is %s', (age, band) => {
    expect(ageBand(ago(age), now)).toBe(band)
  })
})
