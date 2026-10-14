import { createI18n } from '@i18n/react'
import { describe, expect, it } from 'vitest'
import { feeCoversLine, feeLine, introMessage, memberSince } from './copy'

const i18n = createI18n('es')
const now = new Date('2026-10-14T12:00:00Z')

describe('06 · fee rule — how a fee reads', () => {
  it('zero is disclosed too: «Sin cuota»', () => {
    expect(feeLine(i18n, { cop: 0, covers: [] })).toBe('Sin cuota')
    expect(feeCoversLine(i18n, { cop: 0, covers: [] })).toBeNull()
  })

  it('a fee says what it covers', () => {
    const fee = { cop: 150_000, covers: ['sterilization', 'vaccines', 'deworming'] as const }
    expect(feeLine(i18n, { ...fee, covers: [...fee.covers] }).replace(/\s/g, ' ')).toMatch(
      /^Cuota de recuperación: \$ ?150\.000$/,
    )
    expect(feeCoversLine(i18n, { ...fee, covers: [...fee.covers] })).toBe(
      'Cubre esterilización, vacunas y desparasitación.',
    )
  })
})

describe('06 · What the lister sees — facts, never a verdict', () => {
  it('«miembro hace 8 meses»', () => {
    expect(memberSince(i18n, new Date(now.getTime() - 245 * 86_400_000), now)).toBe(
      'miembro hace 8 meses',
    )
    expect(memberSince(i18n, new Date(now.getTime() - 3 * 86_400_000), now)).toBe(
      'miembro hace 3 días',
    )
  })
})

describe('06 · Channel, after the row — the intro prefilled', () => {
  it('carries the four fields and the why, skipping the blank ones', () => {
    expect(
      introMessage(i18n, 'Nube', 'https://example.test/c/AD9PT', {
        housing: 'apartment',
        hasYard: false,
        otherPets: null,
        household: 'Vivo sola',
        why: 'Tengo tiempo.',
      }),
    ).toBe(
      [
        'Hola, me interesa adoptar a Nube: https://example.test/c/AD9PT',
        'Vivo en apartamento, sin patio.',
        'En casa: Vivo sola.',
        'Por qué: Tengo tiempo.',
      ].join('\n'),
    )
  })
})
