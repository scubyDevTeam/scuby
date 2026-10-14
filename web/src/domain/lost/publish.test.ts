import { describe, expect, it } from 'vitest'
import { draftFromPet, emptyDraft, type LostDraft, stepErrors } from './publish'

const now = new Date('2026-10-04T12:00:00Z')
const colombia = { prefix: '+57', mobilePattern: '^3\\d{9}$' }
const context = { now, phoneRules: colombia, verifiedPhone: null }
const ready: LostDraft = {
  ...emptyDraft,
  name: 'Luna',
  species: 'dog',
  size: 'small',
  center: { lat: 6.2447, lng: -75.5916 },
  lastSeenAt: new Date('2026-10-04T09:00:00Z'),
  phone: '300 715 2284',
}

describe('04 · Publishing — what each step needs', () => {
  it('a complete draft passes every step', () => {
    for (const step of [1, 2, 3] as const) expect(stepErrors(step, ready, context)).toEqual([])
  })

  it('step 1 needs a name, a species and a size', () => {
    expect(stepErrors(1, emptyDraft, context)).toEqual([
      'name_required',
      'species_required',
      'size_required',
    ])
  })

  it('step 2 needs an area and a time that is not in the future', () => {
    expect(stepErrors(2, emptyDraft, context)).toEqual(['place_required', 'time_required'])
    const future = { ...ready, lastSeenAt: new Date('2026-10-04T13:00:00Z') }
    expect(stepErrors(2, future, context)).toEqual(['time_in_the_future'])
  })

  it('the area is a point and a preset radius, 300 m unless changed', () => {
    expect(emptyDraft.radiusM).toBe(300)
  })
})

describe('auth.md · the phone step', () => {
  it('a first-time publisher needs a valid mobile number', () => {
    expect(stepErrors(3, { ...ready, phone: '' }, context)).toEqual(['phone_invalid'])
    expect(stepErrors(3, { ...ready, phone: '604 715 2284' }, context)).toEqual(['phone_invalid'])
  })

  it('an already verified number is not asked for again', () => {
    const verified = { ...context, verifiedPhone: '+573007152284' }
    expect(stepErrors(3, { ...ready, phone: '' }, verified)).toEqual([])
  })

  it('at least one way to be reached must stay on', () => {
    const none = { ...ready, contact: { whatsapp: false, email: false, inApp: false } }
    expect(stepErrors(3, none, context)).toEqual(['contact_required'])
  })

  it('WhatsApp cannot be exposed for a number that has none', () => {
    expect(stepErrors(3, { ...ready, hasWhatsapp: false }, context)).toEqual([
      'whatsapp_needs_number',
    ])
    const chatOnly = {
      ...ready,
      hasWhatsapp: false,
      contact: { whatsapp: false, email: false, inApp: true },
    }
    expect(stepErrors(3, chatOnly, context)).toEqual([])
  })
})

describe('04 · the form reuses a pet before it creates one', () => {
  it('fills step 1 from the chosen pet and remembers which one', () => {
    const pet = {
      id: 'pet-1',
      name: 'Luna',
      species: 'dog' as const,
      size: 'small' as const,
      colors: ['Negro'],
      marks: 'Collar rojo',
      photoUrls: ['a.jpg'],
    }
    expect(draftFromPet(emptyDraft, pet)).toMatchObject({
      petId: 'pet-1',
      name: 'Luna',
      colors: ['Negro'],
    })
  })
})
