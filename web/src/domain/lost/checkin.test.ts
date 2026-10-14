import { describe, expect, it } from 'vitest'
import { CHECKIN_ANSWERS, checkinAnswers, checkinStep, closeAnswersCheckin } from './checkin'

const active = { status: 'active' as const, resolvedAt: null }
const timeBased = { trigger: 'time_based' as const }
const claim = { trigger: 'post_recovery_claim' as const }

describe('04 · `case_checkin` — the answers each trigger takes', () => {
  it('a time-based check-in: «Sigue perdida · Ya apareció · Eliminar»', () => {
    expect(checkinAnswers(active, 'owner', timeBased)).toEqual(['still_lost', 'reunited', 'delete'])
  })

  it('a claim check-in: «Sí, es ella · No es ella · Aún verificando»', () => {
    expect(checkinAnswers(active, 'owner', claim)).toEqual([
      'claim_confirmed',
      'claim_dismissed',
      'still_verifying',
    ])
  })

  it('no answer fits both triggers', () => {
    const overlap = CHECKIN_ANSWERS.time_based.filter((r) =>
      CHECKIN_ANSWERS.post_recovery_claim.includes(r),
    )
    expect(overlap).toEqual([])
  })

  it('only the owner is asked, and only while the case is active', () => {
    expect(checkinAnswers(active, 'public', timeBased)).toEqual([])
    expect(
      checkinAnswers({ status: 'expired', resolvedAt: new Date() }, 'owner', timeBased),
    ).toEqual([])
    expect(checkinAnswers(active, 'owner', null)).toEqual([])
  })
})

describe('04 · The follow-up loop — what an answer needs before it is sent', () => {
  it('«Ya apareció» asks who helped, as the reunion always does', () => {
    expect(checkinStep('reunited')).toBe('ask_attribution')
  })

  it('«Eliminar» asks why, as deleting always does', () => {
    expect(checkinStep('delete')).toBe('ask_reason')
  })

  it('the rest are one tap — «Sí, es ella» is always `platform_claim`', () => {
    for (const r of [
      'still_lost',
      'claim_confirmed',
      'claim_dismissed',
      'still_verifying',
    ] as const)
      expect(checkinStep(r)).toBe('send')
  })
})

describe('04 · `case_checkin` — closing the case while a time-based check-in waits', () => {
  it('the reunion and the delete answer it', () => {
    expect(closeAnswersCheckin(timeBased)).toBe(true)
  })

  it('a claim check-in is about the claim, not the case: closing does not answer it', () => {
    expect(closeAnswersCheckin(claim)).toBe(false)
    expect(closeAnswersCheckin(null)).toBe(false)
  })
})
