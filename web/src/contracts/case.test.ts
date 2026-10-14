import { describe, expect, it } from 'vitest'
import { cases } from '../mocks/fixtures'
import { parseCase } from './case'
import { parseFeed } from './feed'

describe('parseCase', () => {
  it('turns the wire shape into app types: camelCase and real dates', () => {
    const parsed = parseCase(cases()['7K3PQ'])
    if (parsed.vertical !== 'lost') throw new Error('expected a lost case')

    expect(parsed.lastSeen.at).toBeInstanceOf(Date)
    expect(parsed.lastSeen.radiusM).toBe(100)
    expect(parsed.sightings[0]?.seenAt).toBeInstanceOf(Date)
    expect(parsed.contact?.whatsappUrl).toMatch(/^https:\/\/wa\.me\//)
  })

  it('keeps the other verticals as a card until their pages exist', () => {
    expect(parseCase(cases().F8UND)).toMatchObject({ vertical: 'found', placeName: 'Belén' })
  })

  it('rejects a status the state machine does not know', () => {
    expect(() => parseCase({ ...cases()['7K3PQ'], status: 'paused' })).toThrow()
  })

  it('rejects a case without its last-seen area', () => {
    expect(() => parseCase({ ...cases()['7K3PQ'], last_seen: undefined })).toThrow()
  })
})

describe('parseFeed', () => {
  it('rejects an unknown scope', () => {
    expect(() => parseFeed({ scope: 'galaxy', items: [] })).toThrow()
  })
})
