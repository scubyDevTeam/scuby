import { createI18n } from '@i18n/react'
import { describe, expect, it } from 'vitest'
import { describePet, formatSeenAt, sightingErrorCopy, sightingsCount } from './copy'

const i18n = createI18n('es')
const pet = { name: 'Luna', marks: null, photoUrls: [] }

describe('lost case copy', () => {
  it('describes a pet by species, size and colors', () => {
    expect(
      describePet(i18n, { ...pet, species: 'dog', size: 'small', colors: ['black', 'tan'] }),
    ).toBe('Perro · Pequeño · Negro y canela')
  })

  it('leaves out what is unknown', () => {
    expect(describePet(i18n, { ...pet, species: 'cat', size: null, colors: [] })).toBe('Gato')
  })

  it('calls an animal of another species a pet', () => {
    expect(describePet(i18n, { ...pet, species: 'other', size: null, colors: [] })).toBe('Mascota')
  })

  it('names today and yesterday, and dates anything older', () => {
    const now = new Date(2026, 9, 4, 12, 0)
    expect(formatSeenAt(i18n, new Date(2026, 9, 4, 9, 40), now)).toMatch(/^Hoy 9:40/)
    expect(formatSeenAt(i18n, new Date(2026, 9, 3, 18, 30), now)).toMatch(/^Ayer 6:30/)
    expect(formatSeenAt(i18n, new Date(2026, 9, 2, 16, 10), now)).toMatch(/^2 oct\.? 4:10/)
  })

  it.each([
    [0, '0 avistamientos'],
    [1, '1 avistamiento'],
    [3, '3 avistamientos'],
  ])('counts %i as «%s»', (count, copy) => {
    expect(sightingsCount(i18n, count)).toBe(copy)
  })

  it('uses the sighting copy fixed by the doc', () => {
    expect(sightingErrorCopy(i18n, 'too_far', 'Luna')).toBe(
      'Ese punto está muy lejos del último lugar donde se vio a Luna',
    )
    expect(sightingErrorCopy(i18n, 'in_the_future', 'Luna')).toBe(
      'La hora no puede ser en el futuro',
    )
    expect(sightingErrorCopy(i18n, 'before_the_case', 'Luna')).toBe(
      'Luna se perdió después de esa hora',
    )
  })
})
