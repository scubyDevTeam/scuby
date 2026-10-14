import { describe, expect, it } from 'vitest'
import { REPORT_REASONS, reportEffect } from './report'

describe('09 · The rules — what a first report does by itself', () => {
  it.each(['graphic_content', 'personal_data'] as const)(
    '%s hides at once, pending review',
    (reason) => {
      expect(reportEffect(reason, 'lost_case')).toBe('hidden_pending_review')
    },
  )

  it('a scam report suspends a help request, which collects money', () => {
    expect(reportEffect('scam_or_extortion', 'help_request')).toBe('suspended_pending_review')
  })

  it('a scam report on any other publication only queues', () => {
    expect(reportEffect('scam_or_extortion', 'lost_case')).toBe('queued')
  })

  it('no other reason ever hides an active case by itself', () => {
    const quiet = REPORT_REASONS.filter(
      (r) => r !== 'graphic_content' && r !== 'personal_data' && r !== 'scam_or_extortion',
    )
    for (const reason of quiet) expect(reportEffect(reason, 'lost_case')).toBe('queued')
  })
})
