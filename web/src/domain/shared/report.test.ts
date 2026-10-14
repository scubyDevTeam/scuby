import { describe, expect, it } from 'vitest'
import { REPORT_REASONS, reportEffect } from './report'

describe('09 · The rules — what a first report does by itself', () => {
  it.each(['graphic_content', 'personal_data'] as const)(
    '%s hides at once, pending review',
    (reason) => {
      expect(reportEffect(reason, 'lost_case')).toBe('hidden_pending_review')
    },
  )

  it.each(['lost_case', 'help_request'] as const)(
    'no other reason ever hides an active %s by itself — help included (07, #26)',
    (target) => {
      const quiet = REPORT_REASONS.filter((r) => r !== 'graphic_content' && r !== 'personal_data')
      for (const reason of quiet) expect(reportEffect(reason, target)).toBe('queued')
    },
  )
})
