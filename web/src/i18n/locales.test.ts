import { describe, expect, it } from 'vitest'
import { LOCALES, type Messages } from './locales'
import en from './locales/en.json'
import es from './locales/es.json'

// Every language file is the source one, translated: same keys, same placeholders, same markup.
const files: Record<(typeof LOCALES)[number], Messages> = { es, en }

type Leaf = { key: string; value: string }

function leaves(node: unknown, prefix = ''): Leaf[] {
  if (typeof node === 'string') return [{ key: prefix, value: node }]
  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
    leaves(value, prefix ? `${prefix}.${key}` : key),
  )
}

const tokens = (value: string) =>
  [...value.matchAll(/\{\w+\}|<\/?\w+>/g)].map(([token]) => token).sort()

const PLURAL = new Set<string>(['zero', 'one', 'two', 'few', 'many', 'other'])
const isPlural = (node: unknown) =>
  typeof node === 'object' &&
  node !== null &&
  'other' in node &&
  Object.keys(node).every((key) => PLURAL.has(key))

function plurals(node: unknown, prefix = ''): string[] {
  if (typeof node !== 'object' || node === null) return []
  if (isPlural(node)) return [prefix]
  return Object.entries(node).flatMap(([key, value]) =>
    plurals(value, prefix ? `${prefix}.${key}` : key),
  )
}

const source = new Map(leaves(es).map((leaf) => [leaf.key, leaf.value]))

describe.each(LOCALES)('locales/%s.json', (locale) => {
  const file = files[locale]
  const own = leaves(file)

  it('has exactly the keys of the source language', () => {
    expect(own.map((leaf) => leaf.key).sort()).toEqual([...source.keys()].sort())
  })

  it('keeps every placeholder and tag of the source', () => {
    // A plural form may spell its number out instead («hace 1 día»), so there {count} is free.
    const inPlural = (key: string) => plurals(es).some((plural) => key.startsWith(`${plural}.`))
    const comparable = (key: string, value: string) =>
      tokens(value).filter((token) => !(inPlural(key) && token === '{count}'))
    for (const { key, value } of own) {
      expect({ key, tokens: comparable(key, value) }).toEqual({
        key,
        tokens: comparable(key, source.get(key) ?? ''),
      })
    }
  })

  it('leaves nothing blank', () => {
    expect(own.filter((leaf) => leaf.value.trim() === '')).toEqual([])
  })

  it('gives every plural the forms the language needs', () => {
    const needed = new Intl.PluralRules(locale)
      .resolvedOptions()
      .pluralCategories.filter((category) => category === 'one' || category === 'other')
    for (const key of plurals(file)) {
      const forms = key.split('.').reduce<unknown>((node, part) => {
        return (node as Record<string, unknown>)[part]
      }, file) as Record<string, string>
      expect({ key, missing: needed.filter((category) => !(category in forms)) }).toEqual({
        key,
        missing: [],
      })
    }
  })
})
