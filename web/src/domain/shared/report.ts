// docs/product/09 · `report` and The rules.
export const REPORT_REASONS = [
  'scam_or_extortion',
  'personal_data',
  'animal_welfare',
  'graphic_content',
  'harassment',
  'duplicate',
  'spam',
  'other',
] as const

export type ReportReason = (typeof REPORT_REASONS)[number]
export type ReportTarget = 'lost_case' | 'found_case' | 'adoption_case' | 'help_request'

/** What a first report does on its own, before any human reviews it. */
export type ReportEffect = 'queued' | 'hidden_pending_review' | 'suspended_pending_review'

/**
 * A report never hides an active case by itself (rule 1) — with the exceptions whose harm compounds
 * every hour: graphic content and personal data (rule 2), and a scam report on a help request,
 * which collects money (rule 4).
 */
export function reportEffect(reason: ReportReason, target: ReportTarget): ReportEffect {
  if (reason === 'graphic_content' || reason === 'personal_data') return 'hidden_pending_review'
  if (reason === 'scam_or_extortion' && target === 'help_request') return 'suspended_pending_review'
  return 'queued'
}
