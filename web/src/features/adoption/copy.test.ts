import { createI18n } from '@i18n/react'
import { describe, expect, it } from 'vitest'
import { introMessage, memberSince } from './copy'

const i18n = createI18n('es')
const now = new Date('2026-10-14T12:00:00Z')

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
