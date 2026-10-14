import { type LostCase, parseCase } from '@contracts/case'
import type { FoundCase } from '@contracts/found'
import { loadMessages } from '@i18n/locales'
import { createI18n } from '@i18n/react'
import { beforeAll, describe, expect, it } from 'vitest'
import { cases } from '../../mocks/fixtures'
import {
  isResponsible,
  posterContent,
  posterFileName,
  shareMessage,
  whatsappShareUrl,
} from './model'

const es = createI18n('es')
beforeAll(() => loadMessages('en', ['sharing']))

const link = { url: 'https://example.test/c/7K3PQ', display: 'example.test/c/7K3PQ' }

function lost(overrides: Partial<LostCase> = {}): LostCase {
  const parsed = parseCase(cases('public')['7K3PQ'])
  if (parsed.vertical !== 'lost') throw new Error('expected a lost case')
  return { ...parsed, ...overrides }
}

function found(): FoundCase {
  const raw = Object.values(cases('public')).find(
    (row) => (row as { vertical?: string }).vertical === 'found',
  )
  const parsed = parseCase(raw)
  if (parsed.vertical !== 'found') throw new Error('expected a found case')
  return parsed
}

describe('posterContent (docs/product/10 §3 · Layout)', () => {
  it('a lost case: «SE BUSCA», the name, its traits, where and when, and the footer', () => {
    const at = new Date(2026, 9, 2, 10)
    const content = posterContent(
      es,
      lost({ lastSeen: { ...lost().lastSeen, at, placeName: 'Laureles' } }),
      link,
      new Date(2026, 9, 5, 10),
    )
    expect(content.label).toBe('SE BUSCA')
    expect(content.title).toBe('Luna')
    expect(content.traits).toBe('Perro · Pequeño · Negro y canela')
    expect(content.line).toBe('Se perdió en Laureles · 2 de octubre · hace 3 días')
    expect(content.footer).toBe('Nadie que de verdad lo tenga te va a pedir dinero por adelantado.')
    expect(content.scan).toBe('ESCANEA EL CÓDIGO')
    expect(content.link).toEqual(link)
  })

  it('a found case: «SE ENCONTRÓ», titled by what the animal looks like', () => {
    const content = posterContent(es, found(), link, new Date())
    expect(content.label).toBe('SE ENCONTRÓ')
    expect(content.title).not.toBe('')
    expect(content.line).toMatch(/^Se encontró en /)
  })

  it('renders in the page’s language', () => {
    expect(posterContent(createI18n('en'), lost(), link, new Date()).label).toBe('MISSING')
  })

  it('without a photo, it says so instead of leaving a grey block', () => {
    const content = posterContent(
      es,
      lost({ pet: { ...lost().pet, photoUrls: [] } }),
      link,
      new Date(),
    )
    expect(content.photoUrl).toBeNull()
    expect(content.noPhoto).toBe('Sin foto — mira las señas')
  })

  it('carries no phone number: contact lives on the page', () => {
    const content = posterContent(es, lost(), link, new Date())
    expect(JSON.stringify(content)).not.toMatch(/\+57|3\d{9}/)
  })
})

describe('shareMessage (docs/product/10 §4 · Pre-written message)', () => {
  it('says who, where and when, and ends in the short link so the preview renders', () => {
    const at = new Date(2026, 1, 10, 10)
    const message = shareMessage(
      es,
      lost({ lastSeen: { ...lost().lastSeen, at, placeName: 'Santa Ana, Medellín' } }),
      link,
    )
    expect(message).toBe(
      '🔎 SE BUSCA: Luna — Santa Ana, Medellín. Perro · Pequeño · Negro y canela. Se perdió el 10 de febrero. Información al día y contacto: https://example.test/c/7K3PQ',
    )
  })

  it('a found case asks whose it is, and ends in the link too', () => {
    const message = shareMessage(es, found(), link)
    expect(message).toMatch(/^🐾 SE ENCONTRÓ: /)
    expect(message.endsWith(link.url)).toBe(true)
  })

  it('goes to WhatsApp as text only', () => {
    expect(whatsappShareUrl('SE BUSCA: Luna — https://example.test/c/7K3PQ')).toBe(
      'https://wa.me/?text=SE%20BUSCA%3A%20Luna%20%E2%80%94%20https%3A%2F%2Fexample.test%2Fc%2F7K3PQ',
    )
  })
})

describe('who gets the framer and the tip', () => {
  it('the owner and the custodian; a helper shares the same poster without them', () => {
    expect(isResponsible(lost({ viewer: 'owner' }))).toBe(true)
    expect(isResponsible({ ...found(), viewer: 'custodian' })).toBe(true)
    expect(isResponsible(lost({ viewer: 'public' }))).toBe(false)
  })
})

describe('posterFileName', () => {
  it('names the file by code and format; print is a PDF', () => {
    expect(posterFileName('7K3PQ', 'story')).toBe('7K3PQ-story.png')
    expect(posterFileName('7K3PQ', 'print')).toBe('7K3PQ-print.pdf')
  })
})
