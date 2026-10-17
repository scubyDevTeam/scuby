import type { FoundCase } from '@contracts/found'
import { loadMessages } from '@i18n/locales'
import { createI18n } from '@i18n/react'
import { beforeAll, describe, expect, it } from 'vitest'
import { describeFound } from './copy'

beforeAll(() => loadMessages('en', ['found']))

const pet: FoundCase['pet'] = {
  species: 'cat',
  size: 'small',
  colors: ['black', 'white'],
  marks: null,
  photoUrls: [],
}

describe('describeFound — a found animal is titled by what it looks like', () => {
  it('reads species, first colour and size in each language’s order', () => {
    expect(describeFound(createI18n('es'), pet)).toBe('Gato negro, pequeño')
    expect(describeFound(createI18n('en'), pet)).toBe('Black cat, small')
  })

  it('leaves out what is unknown', () => {
    const plain: FoundCase['pet'] = { ...pet, species: 'other', size: null, colors: [] }
    expect(describeFound(createI18n('es'), plain)).toBe('Animal')
    expect(describeFound(createI18n('en'), plain)).toBe('Animal')
  })
})
