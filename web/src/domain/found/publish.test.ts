import { describe, expect, it } from 'vitest'
import { emptyFoundDraft, type FoundDraft, foundStepErrors, witnessErrors } from './publish'

const now = new Date('2026-10-04T12:00:00Z')
const context = {
  now,
  phoneRules: { prefix: '+57', mobilePattern: '^3\\d{9}$' },
  verifiedPhone: null,
}
const ready: FoundDraft = {
  ...emptyFoundDraft,
  photoUrls: ['a.jpg'],
  species: 'cat',
  size: 'small',
  center: { lat: 6.24, lng: -75.59 },
  foundAt: new Date('2026-10-04T09:00:00Z'),
  phone: '300 715 2284',
}

describe('05 · Publishing a found case', () => {
  it('a complete draft passes every step', () => {
    for (const step of [1, 2, 3] as const) expect(foundStepErrors(step, ready, context)).toEqual([])
  })

  it('asks for no name, and requires a photo', () => {
    expect(foundStepErrors(1, emptyFoundDraft, context)).toEqual([
      'photo_required',
      'species_required',
      'size_required',
    ])
  })

  it('needs where and when it was found', () => {
    expect(foundStepErrors(2, emptyFoundDraft, context)).toEqual([
      'place_required',
      'time_required',
    ])
  })

  it('starts in-app only: the custodian decides when to show a number', () => {
    expect(emptyFoundDraft.contact).toEqual({ whatsapp: false, email: false, inApp: true })
    expect(foundStepErrors(3, ready, context)).toEqual([])
  })
})

describe('05 · Witness report — pin and photo required', () => {
  const seen = {
    photoUrls: ['a.jpg'],
    species: 'dog' as const,
    point: { lat: 6.24, lng: -75.59 },
    seenAt: now,
  }

  it('accepts a photo, a species, a point and a time', () => {
    expect(witnessErrors(seen, now)).toEqual([])
  })

  it('rejects a report with no photo: it could not be matched to anything', () => {
    expect(witnessErrors({ ...seen, photoUrls: [] }, now)).toEqual(['photo_required'])
  })

  it('rejects a missing point or a future time', () => {
    expect(witnessErrors({ ...seen, point: null }, now)).toEqual(['place_required'])
    const future = new Date(now.getTime() + 60_000)
    expect(witnessErrors({ ...seen, seenAt: future }, now)).toEqual(['time_in_the_future'])
  })
})
