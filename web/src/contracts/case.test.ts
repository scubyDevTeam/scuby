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

  it('parses a help request: needs with confirmed and pledged apart, never one sum', () => {
    const parsed = parseCase(cases().HE7PA)
    if (parsed.vertical !== 'help') throw new Error('expected a help request')
    expect(parsed.needs.map((n) => [n.kind, n.confirmed, n.pledged])).toEqual([
      ['foster', 0, 0],
      ['transport', 0, 1],
      ['supplies', 2, 0],
    ])
    // A stranger never receives who offered or their numbers.
    expect(parsed.pledges).toEqual([])
    expect(parsed.myPledges).toEqual([])
  })

  it('parses an adoption listing, with the lister-only fields empty for everyone else', () => {
    const parsed = parseCase(cases().AD9PT)
    if (parsed.vertical !== 'adoption') throw new Error('expected an adoption listing')
    expect(parsed.publishedAt).toBeInstanceOf(Date)
    expect(parsed.interests).toEqual([])
    expect(parsed.myInterest).toBeNull()
  })

  it('parses a found case, with the custodian-only fields empty for everyone else', () => {
    const parsed = parseCase(cases().F8UND)
    if (parsed.vertical !== 'found') throw new Error('expected a found case')
    expect(parsed.found.at).toBeInstanceOf(Date)
    expect(parsed.holdOfferAt.getTime() - parsed.heldSince.getTime()).toBe(15 * 86_400_000)
    expect(
      parseCase({ ...cases().F8UND, withheld_detail: undefined, ownership_claims: undefined }),
    ).toMatchObject({
      withheldDetail: null,
      ownershipClaims: [],
    })
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
