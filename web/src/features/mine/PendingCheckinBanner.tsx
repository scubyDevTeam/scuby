import { useMyCases } from '@api-client/owner'
import { useI18n } from '@i18n/react'
import { MessageCircleQuestion } from 'lucide-react'
import type { ReactNode } from 'react'

type Props = {
  caseLink: (code: string, children: ReactNode, className: string) => ReactNode
}

/**
 * A question the signed-in person owes an answer to, on home until it is answered
 * (docs/eng/comms.md · Actionable check-ins): whoever ignores every notification still meets it.
 * The case page carries the question itself. Quiet while loading or failing — the feed is the page.
 */
export function PendingCheckinBanner({ caseLink }: Props) {
  const { t } = useI18n()
  const cases = useMyCases()
  const pending = (cases.data ?? [])
    .filter((item) => item.pendingCheckinAt !== null)
    .sort((a, b) => (a.pendingCheckinAt?.getTime() ?? 0) - (b.pendingCheckinAt?.getTime() ?? 0))
  const oldest = pending[0]
  if (!oldest) return null

  return (
    <section
      aria-label={t('checkin_banner.label')}
      className="flex items-center gap-3 rounded-2xl border-2 border-lost bg-lost-soft p-4 text-lost-ink"
    >
      <MessageCircleQuestion aria-hidden="true" className="size-8 shrink-0" />
      <p className="m-0 flex-1">
        <strong>{t(`checkin_banner.title.${oldest.vertical}`, { name: oldest.title })}</strong>{' '}
        {pending.length > 1
          ? t('checkin_banner.more', { count: String(pending.length - 1) })
          : t('checkin_banner.body')}
      </p>
      {caseLink(
        oldest.code,
        t('checkin_banner.answer'),
        'shrink-0 rounded-2xl bg-lost px-4 py-3 font-bold text-white no-underline',
      )}
    </section>
  )
}
