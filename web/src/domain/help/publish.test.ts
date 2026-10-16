import { describe, expect, it } from 'vitest'
import {
  emptyHelpDraft,
  type HelpDraft,
  helpStepErrors,
  needErrors,
  newNeed,
  targetOf,
} from './publish'

const today = '2026-10-14'
const context = {
  today,
  phoneRules: { prefix: '+57', mobilePattern: '^3\\d{9}$' },
  verifiedPhone: '+573007152284',
}
const foster = { ...newNeed('foster'), detail: '2 semanas mientras se recupera' }
const ready: HelpDraft = {
  ...emptyHelpDraft,
  name: 'Max',
  species: 'dog',
  size: 'large',
  needs: [foster],
  story: 'Lo operaron de la cadera.',
  center: { lat: 6.17, lng: -75.59 },
}

describe('07 · Publishing — what each step needs', () => {
  it('a complete draft passes every step', () => {
    for (const step of [1, 2, 3] as const) expect(helpStepErrors(step, ready, context)).toEqual([])
  })

  it('step 1: a new pet needs a name, a species and a size; an existing one, nothing', () => {
    expect(helpStepErrors(1, emptyHelpDraft, context)).toEqual([
      'name_required',
      'species_required',
      'size_required',
    ])
    expect(helpStepErrors(1, { ...emptyHelpDraft, petId: 'pet-luna' }, context)).toEqual([])
  })

  it('step 3: where, the story and a reachable phone', () => {
    const empty = { ...ready, center: null, story: ' ' }
    expect(helpStepErrors(3, empty, context)).toEqual(['place_required', 'story_required'])
    expect(helpStepErrors(3, ready, { ...context, verifiedPhone: null })).toEqual(['phone_invalid'])
  })
})

describe('07 · `help_need` — one to three bounded asks', () => {
  it('needs at least one, and at most three', () => {
    expect(needErrors([], today)).toEqual(['needs_required'])
    expect(needErrors([foster, foster, foster, foster], today)).toEqual(['too_many_needs'])
  })

  it('every need says exactly what is asked', () => {
    expect(needErrors([newNeed('transport')], today)).toEqual(['need_detail_required'])
  })

  it('a target is a whole number, or nothing for «lo que puedan»', () => {
    expect(needErrors([{ ...foster, target: '0' }], today)).toEqual(['need_target_invalid'])
    expect(needErrors([{ ...foster, target: '2,5' }], today)).toEqual(['need_target_invalid'])
    expect(needErrors([{ ...foster, target: '' }], today)).toEqual([])
    expect(targetOf({ ...foster, target: ' 3 ' })).toBe(3)
    expect(targetOf({ ...foster, target: '' })).toBeNull()
  })

  it('a date that matters cannot already be gone', () => {
    expect(needErrors([{ ...foster, neededBy: '2026-10-13' }], today)).toEqual(['needed_by_past'])
    expect(needErrors([{ ...foster, neededBy: today }], today)).toEqual([])
  })

  it('a foster or a ride starts at one; supplies start at «lo que puedan»', () => {
    expect(newNeed('foster').target).toBe('1')
    expect(newNeed('transport').target).toBe('1')
    expect(newNeed('supplies').target).toBe('')
  })
})
