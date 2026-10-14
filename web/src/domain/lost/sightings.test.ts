import { describe, expect, it } from 'vitest'
import { durations } from '../shared/time'
import { placeSightings, sightingErrorCopy, validateSighting } from './sightings'

const now = new Date('2026-10-04T12:00:00Z')
const ago = (ms: number) => new Date(now.getTime() - ms)
const lastSeenPoint = { lat: 6.2447, lng: -75.5916 }
const context = { lastSeenPoint, lastSeenAt: ago(2 * durations.DAY), petName: 'Luna' }
const near = { lat: 6.2467, lng: -75.5916 }

describe('04 · Validation — sighting pre-checks', () => {
  it('accepts a nearby pin seen after the loss', () => {
    expect(validateSighting({ point: near, seenAt: ago(durations.HOUR) }, context, now)).toEqual([])
  })

  it('rejects a pin more than 30 km from the last-seen point', () => {
    const bogota = { lat: 4.711, lng: -74.0721 }
    expect(validateSighting({ point: bogota, seenAt: ago(durations.HOUR) }, context, now)).toEqual([
      'too_far',
    ])
  })

  it('rejects a time in the future', () => {
    const draft = { point: near, seenAt: new Date(now.getTime() + durations.MINUTE) }
    expect(validateSighting(draft, context, now)).toEqual(['in_the_future'])
  })

  it('accepts up to 24 h before the loss and rejects earlier', () => {
    const justInside = { point: near, seenAt: ago(2 * durations.DAY + 23 * durations.HOUR) }
    const tooEarly = { point: near, seenAt: ago(3 * durations.DAY + durations.HOUR) }
    expect(validateSighting(justInside, context, now)).toEqual([])
    expect(validateSighting(tooEarly, context, now)).toEqual(['before_the_case'])
  })

  it('uses the copy fixed by the doc', () => {
    expect(sightingErrorCopy('too_far', 'Luna')).toBe(
      'Ese punto está muy lejos del último lugar donde se vio a Luna',
    )
    expect(sightingErrorCopy('in_the_future', 'Luna')).toBe('La hora no puede ser en el futuro')
    expect(sightingErrorCopy('before_the_case', 'Luna')).toBe('Luna se perdió después de esa hora')
  })
})

describe('04 · Display rules — trajectory', () => {
  const sighting = (id: string, age: number, highlightedByOwner = false) => ({
    id,
    point: near,
    seenAt: ago(age),
    highlightedByOwner,
  })

  it('numbers pins from the oldest and marks the newest as latest', () => {
    const placed = placeSightings(
      [
        sighting('b', 17 * durations.HOUR),
        sighting('c', 2 * durations.HOUR),
        sighting('a', 2 * durations.DAY),
      ],
      lastSeenPoint,
      now,
    )
    expect(placed.map((s) => [s.id, s.order, s.isLatest])).toEqual([
      ['a', 1, false],
      ['b', 2, false],
      ['c', 3, true],
    ])
  })

  it('a late report takes its place in time, not the top (rule 6)', () => {
    const placed = placeSightings(
      [sighting('fresh', durations.HOUR), sighting('late', 2 * durations.DAY)],
      lastSeenPoint,
      now,
    )
    expect(placed.find((s) => s.id === 'late')).toMatchObject({
      order: 1,
      isLatest: false,
      band: 'under_3d',
    })
  })

  it('an owner highlight keeps an old pin full size (rule 5)', () => {
    const placed = placeSightings(
      [sighting('old', 4 * durations.DAY, true), sighting('new', durations.HOUR)],
      lastSeenPoint,
      now,
    )
    expect(placed.map((s) => s.emphasized)).toEqual([true, true])
  })
})
