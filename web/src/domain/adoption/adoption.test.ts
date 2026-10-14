import { describe, expect, it } from 'vitest'
import { durations } from '../shared/time'
import { availableActions, pageMode, reservedNotice } from './actions'
import { channelAfterInterest, emptyIntro, introErrors, whatsappWithText } from './interest'
import {
  type AdoptionCaseState,
  type AdoptionEvent,
  interestMoves,
  isReserved,
  transition,
} from './machine'

const now = new Date('2026-10-14T12:00:00Z')
const ago = (days: number) => new Date(now.getTime() - days * durations.DAY)
const active: AdoptionCaseState = { status: 'active', resolvedAt: null }
const expired = (days: number): AdoptionCaseState => ({ status: 'expired', resolvedAt: ago(days) })
const reopen: AdoptionEvent = { type: 'lister_reopens', at: now }

describe('06 · Case state machine — every arrow', () => {
  it.each([
    ['activity', 'active'],
    ['lister_records_adoption', 'adopted'],
    ['lister_withdraws', 'withdrawn'],
    ['checkins_unanswered', 'expired'],
  ] as const)('active --%s--> %s', (type, next) => {
    expect(transition(active, { type })).toBe(next)
  })

  it('expired --lister reopens within 90 days--> active (not lost/found’s 30)', () => {
    expect(transition(expired(60), reopen)).toBe('active')
    expect(transition(expired(91), reopen)).toBeNull()
  })

  it.each(['adopted', 'withdrawn'] as const)('%s is terminal', (status) => {
    const state = { status, resolvedAt: ago(1) }
    for (const event of [
      { type: 'activity' } as const,
      { type: 'lister_withdraws' } as const,
      reopen,
    ]) {
      expect(transition(state, event)).toBeNull()
    }
  })
})

describe('06 · Identity ladder — what each viewer is offered', () => {
  it('a stranger: «Me interesa», share, report — contact only through an interest', () => {
    expect(availableActions(active, 'public', null, now)).toEqual([
      'express_interest',
      'share',
      'report_content',
    ])
  })

  it('one interest per person: with one open, tapping again reopens its conversation', () => {
    expect(availableActions(active, 'public', { status: 'open' }, now)).toContain(
      'open_conversation',
    )
    expect(availableActions(active, 'public', { status: 'open' }, now)).not.toContain(
      'express_interest',
    )
    expect(availableActions(active, 'public', { status: 'withdrawn' }, now)).toContain(
      'express_interest',
    )
  })

  it('the lister: the outcome, taking it down, sharing — never «Me interesa»', () => {
    expect(availableActions(active, 'lister', null, now)).toEqual([
      'record_adoption',
      'withdraw_listing',
      'share',
    ])
  })

  it('adopted or withdrawn: a banner and the card, no actions (10 §1)', () => {
    const adopted = { status: 'adopted' as const, resolvedAt: ago(1) }
    expect(pageMode(adopted)).toBe('closed')
    expect(availableActions(adopted, 'public', null, now)).toEqual([])
    expect(availableActions(adopted, 'lister', null, now)).toEqual([])
  })

  it('expired: archived, reopenable by its lister for 90 days', () => {
    expect(pageMode(expired(1))).toBe('archived')
    expect(availableActions(expired(10), 'lister', null, now)).toEqual(['reopen'])
    expect(availableActions(expired(100), 'lister', null, now)).toEqual([])
    expect(availableActions(expired(10), 'public', null, now)).toEqual([])
  })
})

describe('06 · What the lister sees — the three actions', () => {
  it('«en proceso» is EXISTS chosen, never a status', () => {
    expect(isReserved([{ status: 'open' }, { status: 'chosen' }])).toBe(true)
    expect(isReserved([{ status: 'declined' }])).toBe(false)
  })

  it('one chosen at a time: «no se concretó» comes before choosing another', () => {
    expect(interestMoves('open', false)).toEqual(['choose', 'decline'])
    expect(interestMoves('open', true)).toEqual(['decline'])
    expect(interestMoves('chosen', true)).toEqual(['fell_through'])
    expect(interestMoves('declined', false)).toEqual(['restore'])
    expect(interestMoves('withdrawn', false)).toEqual([])
  })

  it('a reserved listing invites backups; the chosen person is told it is them', () => {
    expect(reservedNotice(true, null)).toBe('backup_invited')
    expect(reservedNotice(true, { status: 'open' })).toBe('backup_invited')
    expect(reservedNotice(true, { status: 'chosen' })).toBe('chosen_you')
    expect(reservedNotice(false, null)).toBeNull()
  })
})

describe('06 · adoption_interest — the intro, then the channel', () => {
  it('housing, yard and «¿por qué este?» are answered; other pets and household may be blank', () => {
    expect(introErrors(emptyIntro)).toEqual(['housing_required', 'yard_required', 'why_required'])
    expect(
      introErrors({ ...emptyIntro, housing: 'house', hasYard: false, why: 'Porque sí' }),
    ).toEqual([])
    expect(introErrors({ ...emptyIntro, housing: 'house', hasYard: true, why: '   ' })).toEqual([
      'why_required',
    ])
  })

  it.each([
    [{ whatsappUrl: 'https://wa.me/57300', externalUrl: null }, 'whatsapp'],
    [{ whatsappUrl: null, externalUrl: 'https://org.example' }, 'external'],
    [{ whatsappUrl: 'https://wa.me/57300', externalUrl: 'https://org.example' }, 'choose'],
    [{ whatsappUrl: null, externalUrl: null }, 'in_app'],
  ] as const)('channels %o → %s', (channels, channel) => {
    expect(channelAfterInterest(channels)).toBe(channel)
  })

  it('WhatsApp opens with the intro prefilled', () => {
    expect(whatsappWithText('https://wa.me/57300', 'Hola & más')).toBe(
      'https://wa.me/57300?text=Hola%20%26%20m%C3%A1s',
    )
  })
})
