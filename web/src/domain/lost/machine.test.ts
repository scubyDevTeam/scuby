import { describe, expect, it } from 'vitest'
import { durations } from '../shared/time'
import { availableActions, pageMode } from './actions'
import { type LostCaseState, type LostEvent, type LostStatus, transition } from './machine'

const now = new Date('2026-10-04T12:00:00Z')
const active: LostCaseState = { status: 'active', resolvedAt: null }
const closed = (status: LostStatus, daysAgo = 1): LostCaseState => ({
  status,
  resolvedAt: new Date(now.getTime() - daysAgo * durations.DAY),
})
const reopen: LostEvent = { type: 'owner_reopens', at: now }

describe('04 · Case state machine — every arrow', () => {
  it.each([
    ['activity', 'active'],
    ['owner_confirms_reunited', 'reunited'],
    ['checkins_unanswered', 'expired'],
    ['owner_cancels', 'cancelled'],
  ] as const)('active --%s--> %s', (type, next) => {
    expect(transition(active, { type })).toBe(next)
  })

  it('expired --owner reopens within 30 days--> active', () => {
    expect(transition(closed('expired', 29), reopen)).toBe('active')
  })
})

describe('04 · Case state machine — arrows that do not exist', () => {
  it('active cannot be reopened', () => {
    expect(transition(active, reopen)).toBeNull()
  })

  it('expired cannot be reopened after 30 days', () => {
    expect(transition(closed('expired', 31), reopen)).toBeNull()
  })

  it('expired cannot jump to reunited (only the owner of an active case closes it)', () => {
    expect(transition(closed('expired'), { type: 'owner_confirms_reunited' })).toBeNull()
  })

  it.each(['reunited', 'cancelled'] as const)('%s is terminal', (status) => {
    const events: LostEvent[] = [
      { type: 'activity' },
      { type: 'owner_confirms_reunited' },
      { type: 'checkins_unanswered' },
      { type: 'owner_cancels' },
      reopen,
    ]
    for (const event of events) expect(transition(closed(status), event)).toBeNull()
  })
})

describe('10 §1 — what the page offers by status', () => {
  it('an active case offers helpers the sighting and the claim, never the close', () => {
    const actions = availableActions(active, 'public', now)
    expect(actions).toContain('report_sighting')
    expect(actions).toContain('claim_recovery')
    expect(actions).not.toContain('confirm_reunited')
  })

  it('only the owner edits an active case, and only while it is active', () => {
    expect(availableActions(active, 'owner', now)).toContain('edit')
    expect(availableActions(active, 'public', now)).not.toContain('edit')
    for (const status of ['reunited', 'cancelled'] as const) {
      expect(availableActions(closed(status), 'owner', now)).not.toContain('edit')
    }
  })

  it('only the owner can close an active case', () => {
    expect(availableActions(active, 'owner', now)).toContain('confirm_reunited')
  })

  it.each(['reunited', 'cancelled'] as const)(
    'a %s case shows a banner and no actions',
    (status) => {
      expect(pageMode(closed(status))).toBe('closed')
      expect(availableActions(closed(status), 'public', now)).toEqual([])
      expect(availableActions(closed(status), 'owner', now)).toEqual([])
    },
  )

  it('an expired case is archived: reopenable by the owner, nothing for anyone else', () => {
    expect(pageMode(closed('expired'))).toBe('archived')
    expect(availableActions(closed('expired'), 'owner', now)).toEqual(['reopen'])
    expect(availableActions(closed('expired'), 'public', now)).toEqual([])
  })
})
