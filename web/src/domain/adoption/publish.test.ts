import { describe, expect, it } from 'vitest'
import {
  adoptionStepErrors,
  draftFromFound,
  emptyAdoptionDraft,
  feeAmount,
  feeErrors,
} from './publish'

const context = { phoneRules: null, verifiedPhone: '+573001112233', converting: false }

describe('06 · Rule: fee disclosure is mandatory, including zero', () => {
  it('unanswered is not «no»: the cuota cannot be left blank', () => {
    expect(feeErrors({ hasFee: null, fee: '', feeCovers: [] })).toEqual(['fee_required'])
  })

  it('«Sin cuota» is an answer: zero', () => {
    expect(feeErrors({ hasFee: false, fee: '', feeCovers: [] })).toEqual([])
    expect(feeAmount({ hasFee: false, fee: '' })).toBe(0)
  })

  it('a fee needs an amount and what it covers', () => {
    expect(feeErrors({ hasFee: true, fee: '', feeCovers: [] })).toEqual([
      'fee_amount_required',
      'fee_covers_required',
    ])
    expect(feeErrors({ hasFee: true, fee: '$150.000', feeCovers: ['vaccines'] })).toEqual([])
    expect(feeAmount({ hasFee: true, fee: '$150.000' })).toBe(150_000)
  })
})

describe('06 · adoption_case — what the listing form asks', () => {
  it('step 1: a name, a photo, species, size, and who the lister is to the animal', () => {
    expect(adoptionStepErrors(1, emptyAdoptionDraft, context)).toEqual([
      'name_required',
      'photo_required',
      'species_required',
      'size_required',
      'role_required',
    ])
  })

  it('a converted stray keeps its custodian link: no role question', () => {
    expect(
      adoptionStepErrors(1, emptyAdoptionDraft, { ...context, converting: true }),
    ).not.toContain('role_required')
  })

  it('step 2: the story, and the fee answered', () => {
    expect(adoptionStepErrors(2, emptyAdoptionDraft, context)).toEqual([
      'story_required',
      'fee_required',
    ])
  })

  it('step 3: the area, a real link if any, and the phone step', () => {
    expect(
      adoptionStepErrors(3, { ...emptyAdoptionDraft, externalUrl: 'mi sitio' }, context),
    ).toEqual(['place_required', 'external_url_invalid'])
  })
})

describe('05 · the day-15 offer — «Publicar en adopción» arrives pre-filled', () => {
  it('with the found animal’s photos, traits, place and how it was found', () => {
    const draft = draftFromFound({
      pet: { species: 'dog', size: 'medium', colors: ['brown'], photoUrls: ['a.jpg'], marks: null },
      center: { lat: 6.2, lng: -75.5 },
      radiusM: 300,
      story: 'Lo encontraron en Estadio el 28 de septiembre.',
    })
    expect(draft).toMatchObject({
      species: 'dog',
      photoUrls: ['a.jpg'],
      listerRole: 'custodian',
      story: 'Lo encontraron en Estadio el 28 de septiembre.',
      center: { lat: 6.2, lng: -75.5 },
    })
  })
})
