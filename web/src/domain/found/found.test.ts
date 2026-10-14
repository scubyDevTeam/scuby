import { describe, expect, it } from 'vitest'
import { durations } from '../shared/time'
import { availableActions, pageMode } from './actions'
import { evidenceTier } from './evidence'
import {
  type FoundCaseState,
  type FoundEvent,
  type FoundStatus,
  holdOfferAt,
  holdOfferDue,
  transition,
} from './machine'

const now = new Date('2026-10-04T12:00:00Z')
const ago = (ms: number) => new Date(now.getTime() - ms)
const active: FoundCaseState = { status: 'active', resolvedAt: null }
const closed = (status: FoundStatus, days = 1): FoundCaseState => ({
  status,
  resolvedAt: ago(days * durations.DAY),
})
const reopen: FoundEvent = { type: 'custodian_reopens', at: now }

describe('05 · Case state machine — every arrow', () => {
  it.each([
    ['activity', 'active'],
    ['custodian_confirms_handoff', 'reunited'],
    ['custodian_keeps', 'kept'],
    ['adoption_offer_accepted', 'converted'],
    ['custodian_hands_to_org', 'transferred_to_org'],
    ['checkins_unanswered', 'expired'],
    ['custodian_cancels', 'cancelled'],
  ] as const)('active --%s--> %s', (type, next) => {
    expect(transition(active, { type })).toBe(next)
  })

  it('expired --custodian reopens within 30 days--> active', () => {
    expect(transition(closed('expired', 29), reopen)).toBe('active')
    expect(transition(closed('expired', 31), reopen)).toBeNull()
  })

  it.each(['reunited', 'kept', 'converted', 'transferred_to_org', 'cancelled'] as const)(
    '%s is terminal',
    (status) => {
      const events: FoundEvent[] = [
        { type: 'activity' },
        { type: 'custodian_confirms_handoff' },
        { type: 'custodian_keeps' },
        { type: 'custodian_cancels' },
        reopen,
      ]
      for (const event of events) expect(transition(closed(status), event)).toBeNull()
    },
  )
})

describe('05 · Two clocks — the hold clock', () => {
  const held = (days: number, hasConfirmedClaim = false) =>
    holdOfferDue(
      { status: 'active', offerAt: holdOfferAt(ago(days * durations.DAY)), hasConfirmedClaim },
      now,
    )

  it('offers a way out at 15 days in limbo, not before', () => {
    expect(held(14)).toBe(false)
    expect(held(15)).toBe(true)
    expect(held(40)).toBe(true)
  })

  it('makes no offer once a claim is confirmed', () => {
    expect(held(20, true)).toBe(false)
  })

  it('«sigo buscando» re-arms it 15 days ahead', () => {
    const facts = { status: 'active' as const, offerAt: holdOfferAt(now), hasConfirmedClaim: false }
    expect(holdOfferDue(facts, now)).toBe(false)
    expect(holdOfferDue(facts, new Date(now.getTime() + 15 * durations.DAY))).toBe(true)
  })

  it('makes no offer on a case that is no longer active', () => {
    const facts = {
      status: 'kept' as const,
      offerAt: holdOfferAt(ago(20 * durations.DAY)),
      hasConfirmedClaim: false,
    }
    expect(holdOfferDue(facts, now)).toBe(false)
  })
})

describe('05 · who can do what', () => {
  it('«Es mío» is for the public; closing is the custodian’s alone', () => {
    expect(availableActions(active, 'public', now)).toContain('claim_ownership')
    expect(availableActions(active, 'public', now)).not.toContain('confirm_reunited')
    expect(availableActions(active, 'custodian', now)).toEqual(
      expect.arrayContaining(['confirm_reunited', 'keep', 'transfer_to_org', 'cancel']),
    )
    expect(availableActions(active, 'custodian', now)).not.toContain('claim_ownership')
  })

  it('a closed case offers nothing; an archived one only its reopening', () => {
    expect(pageMode(closed('kept'))).toBe('closed')
    expect(availableActions(closed('kept'), 'custodian', now)).toEqual([])
    expect(pageMode(closed('expired'))).toBe('archived')
    expect(availableActions(closed('expired'), 'custodian', now)).toEqual(['reopen'])
    expect(availableActions(closed('expired'), 'public', now)).toEqual([])
  })
})

describe('05 · The evidence ladder', () => {
  const cold = { fromLostCaseCode: null, notes: null, chipNumber: null, photoCount: 0 }

  it('a lost case published earlier beats everything else attached', () => {
    expect(evidenceTier({ ...cold, fromLostCaseCode: '7K3PQ', notes: 'x', chipNumber: '1' })).toBe(
      'prior_lost_case',
    )
  })

  it('a description to compare with the withheld detail comes next', () => {
    expect(evidenceTier({ ...cold, notes: 'Tiene una cicatriz', chipNumber: '123' })).toBe(
      'described',
    )
  })

  it('a chip number or photos count as documents', () => {
    expect(evidenceTier({ ...cold, chipNumber: '123' })).toBe('documented')
    expect(evidenceTier({ ...cold, photoCount: 2 })).toBe('documented')
  })

  it('a cold claim is allowed and labelled as such', () => {
    expect(evidenceTier(cold)).toBe('none')
    expect(evidenceTier({ ...cold, notes: '   ' })).toBe('none')
  })
})
