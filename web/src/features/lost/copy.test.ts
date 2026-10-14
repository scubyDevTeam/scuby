import { describe, expect, it } from 'vitest'
import { describePet, formatSeenAt, sightingsCount } from './copy'

const pet = { name: 'Luna', marks: null, photoUrls: [] }

describe('lost case copy', () => {
  it('describes a pet by species, size and colors', () => {
    expect(
      describePet({ ...pet, species: 'dog', size: 'small', colors: ['Negro', 'canela'] }),
    ).toBe('Perro · Pequeño · Negro y canela')
  })

  it('leaves out what is unknown', () => {
    expect(describePet({ ...pet, species: 'cat', size: null, colors: [] })).toBe('Gato')
  })

  it('names today and yesterday, and dates anything older', () => {
    const now = new Date(2026, 9, 4, 12, 0)
    expect(formatSeenAt(new Date(2026, 9, 4, 9, 40), now)).toMatch(/^Hoy 9:40/)
    expect(formatSeenAt(new Date(2026, 9, 3, 18, 30), now)).toMatch(/^Ayer 6:30/)
    expect(formatSeenAt(new Date(2026, 9, 2, 16, 10), now)).toMatch(/^2 oct\.? 4:10/)
  })

  it.each([
    [0, '0 avistamientos'],
    [1, '1 avistamiento'],
    [3, '3 avistamientos'],
  ])('counts %i as «%s»', (count, copy) => {
    expect(sightingsCount(count)).toBe(copy)
  })
})
