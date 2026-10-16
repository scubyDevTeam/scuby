import { describe, expect, it } from 'vitest'
import { durations } from '../shared/time'
import { availableActions, pageMode } from './actions'
import {
  type HelpCaseState,
  type HelpEvent,
  type HelpStatus,
  pledgeMoves,
  transition,
} from './machine'
import { acceptsPledges, progress, reachedTarget } from './needs'

const now = new Date('2026-10-14T12:00:00Z')
const active: HelpCaseState = { status: 'active', resolvedAt: null }
const ended = (status: HelpStatus, days = 1): HelpCaseState => ({
  status,
  resolvedAt: new Date(now.getTime() - days * durations.DAY),
})
const reopen: HelpEvent = { type: 'beneficiary_reopens', at: now }

describe('07 · Case state machine — every arrow', () => {
  it.each([
    ['activity', 'active'],
    ['every_need_covered', 'closed'],
    ['beneficiary_closes', 'closed'],
    ['checkins_unanswered', 'expired'],
    ['moderation_removes', 'removed'],
  ] as const)('active --%s--> %s', (type, next) => {
    expect(transition(active, { type })).toBe(next)
  })

  it('expired --beneficiary reopens within 30 days--> active', () => {
    expect(transition(ended('expired', 29), reopen)).toBe('active')
    expect(transition(ended('expired', 31), reopen)).toBeNull()
  })

  it('active cannot be reopened', () => {
    expect(transition(active, reopen)).toBeNull()
  })

  it.each(['closed', 'removed'] as const)('%s is terminal', (status) => {
    const events: HelpEvent[] = [
      { type: 'activity' },
      { type: 'beneficiary_closes' },
      { type: 'moderation_removes' },
      reopen,
    ]
    for (const event of events) expect(transition(ended(status), event)).toBeNull()
  })
})

describe('07 · `help_pledge` — only the beneficiary confirms', () => {
  it('a pledge waiting for an answer can be confirmed or declined', () => {
    expect(pledgeMoves('pledged')).toEqual(['confirm', 'decline'])
  })

  it.each(['confirmed', 'declined', 'withdrawn'] as const)('a %s pledge is final', (status) => {
    expect(pledgeMoves(status)).toEqual([])
  })
})

describe('07 · progress — confirmed first, pledged second, never one self-reported number', () => {
  const p = (status: 'pledged' | 'confirmed' | 'declined' | 'withdrawn', quantity = 1) => ({
    status,
    quantity,
  })

  it('counts confirmed and pledged apart, and ignores declined and withdrawn', () => {
    expect(
      progress(3, [p('confirmed', 2), p('pledged'), p('declined', 5), p('withdrawn')]),
    ).toEqual({
      confirmed: 2,
      pledged: 1,
      target: 3,
    })
  })

  it('pledges alone never cover a need: a promise is not a ride', () => {
    expect(reachedTarget(progress(1, [p('pledged'), p('pledged')]))).toBe(false)
    expect(reachedTarget(progress(1, [p('confirmed')]))).toBe(true)
  })

  it('a need without a target is covered only by the beneficiary’s word', () => {
    expect(reachedTarget(progress(null, [p('confirmed', 50)]))).toBe(false)
  })

  it('takes pledges while it is open and short of its target', () => {
    expect(acceptsPledges('open', progress(1, [p('pledged')]))).toBe(true)
    expect(acceptsPledges('open', progress(1, [p('confirmed')]))).toBe(false)
    expect(acceptsPledges('covered', progress(null, []))).toBe(false)
  })
})

describe('07 · Identity ladder — who can do what', () => {
  it('a visitor can offer help; the beneficiary closes, and never offers to themselves', () => {
    expect(availableActions(active, 'public', now)).toEqual(['pledge', 'share', 'report_content'])
    expect(availableActions(active, 'beneficiary', now)).toEqual(['close_request', 'share'])
  })

  it('a closed or removed request shows a banner and no actions', () => {
    for (const status of ['closed', 'removed'] as const) {
      expect(pageMode(ended(status))).toBe('closed')
      expect(availableActions(ended(status), 'beneficiary', now)).toEqual([])
    }
  })

  it('an expired request is archived: reopenable by the beneficiary for 30 days', () => {
    expect(pageMode(ended('expired'))).toBe('archived')
    expect(availableActions(ended('expired', 10), 'beneficiary', now)).toEqual(['reopen'])
    expect(availableActions(ended('expired', 40), 'beneficiary', now)).toEqual([])
    expect(availableActions(ended('expired', 10), 'public', now)).toEqual([])
  })
})
