import { describe, expect, it } from 'vitest'
import { durations } from '../shared/time'
import {
  canEditOwn,
  moderationChange,
  moderationOptions,
  pinToCorrect,
  placeSightings,
  splitHidden,
  validateSighting,
} from './sightings'

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

describe('04 · Display rules — the trajectory joins visible pins (rule 2)', () => {
  it('sets hidden pins apart, so they neither draw nor number', () => {
    const { visible, hidden } = splitHidden([
      { id: 'a', hidden: false },
      { id: 'b', hidden: true },
      { id: 'c', hidden: false },
    ])
    expect(visible.map((s) => s.id)).toEqual(['a', 'c'])
    expect(hidden.map((s) => s.id)).toEqual(['b'])
  })
})

describe('04 · Display rules — the owner hides or highlights a pin (rules 3 and 5)', () => {
  it('offers the owner «marcar como útil» and hide on a visible pin', () => {
    expect(moderationOptions({ hidden: false, highlightedByOwner: false }, 'owner')).toEqual([
      'highlight',
      'hide',
    ])
  })

  it('a starred pin can be unstarred', () => {
    expect(moderationOptions({ hidden: false, highlightedByOwner: true }, 'owner')).toEqual([
      'unhighlight',
      'hide',
    ])
  })

  it('a hidden pin offers only its way back to the map', () => {
    expect(moderationOptions({ hidden: true, highlightedByOwner: true }, 'owner')).toEqual([
      'unhide',
    ])
  })

  it('nobody but the owner moderates', () => {
    expect(moderationOptions({ hidden: false, highlightedByOwner: false }, 'public')).toEqual([])
  })

  it('sends only the field that changes', () => {
    expect(moderationChange('highlight')).toEqual({ highlighted: true })
    expect(moderationChange('unhighlight')).toEqual({ highlighted: false })
    expect(moderationChange('hide')).toEqual({ hidden: true })
    expect(moderationChange('unhide')).toEqual({ hidden: false })
  })
})

describe('your own pins (04 · Second pin, Correction window)', () => {
  const now = new Date('2026-10-14T12:00:00-05:00')
  const at = (minutes: number) => new Date(now.getTime() + minutes * 60_000)
  const pin = (
    fields: Partial<{
      mine: boolean
      editableUntil: Date | null
      seenAt: Date
      hidden: boolean
    }> = {},
  ) => ({
    mine: true,
    editableUntil: at(10),
    seenAt: at(-5),
    hidden: false,
    ...fields,
  })

  it('is editable only while it is yours and the window is open', () => {
    expect(canEditOwn(pin(), now)).toBe(true)
    expect(canEditOwn(pin({ editableUntil: at(-1) }), now)).toBe(false)
    expect(canEditOwn(pin({ editableUntil: null }), now)).toBe(false)
    expect(canEditOwn(pin({ mine: false }), now)).toBe(false)
  })

  it('asks about the latest of your editable pins, never another person’s, a hidden or an expired one', () => {
    const older = pin({ seenAt: at(-30) })
    const latest = pin({ seenAt: at(-5) })
    expect(pinToCorrect([older, latest, pin({ mine: false, seenAt: at(-1) })], now)).toBe(latest)
    expect(pinToCorrect([pin({ hidden: true })], now)).toBeNull()
    expect(pinToCorrect([pin({ editableUntil: at(-2) })], now)).toBeNull()
    expect(pinToCorrect([], now)).toBeNull()
  })
})
