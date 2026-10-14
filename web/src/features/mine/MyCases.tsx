import { useMyCases } from '@api-client/owner'
import type { MyCase } from '@contracts/owner'
import { useI18n } from '@i18n/react'
import type { TextKey } from '@i18n/translate'
import { Badge, type BadgeTone } from '@ui/Badge'
import { Button } from '@ui/Button'
import { Message, Skeleton } from '@ui/States'
import { FilePlus2, WifiOff } from 'lucide-react'
import type { ReactNode } from 'react'

const statusBadge: Record<string, { tone: BadgeTone; label: TextKey }> = {
  active: { tone: 'lost', label: 'mine.status.active' },
  reunited: { tone: 'found', label: 'mine.status.reunited' },
  expired: { tone: 'info', label: 'mine.status.expired' },
  cancelled: { tone: 'info', label: 'mine.status.cancelled' },
  kept: { tone: 'found', label: 'mine.status.kept' },
  converted: { tone: 'adoption', label: 'mine.status.converted' },
  transferred_to_org: { tone: 'found', label: 'mine.status.transferred_to_org' },
}

type Props = {
  caseLink: (code: string, children: ReactNode, className: string) => ReactNode
  publishLink: (children: ReactNode, className: string) => ReactNode
}

/** Everything the signed-in person has published, newest first. */
export function MyCases({ caseLink, publishLink }: Props) {
  const { t } = useI18n()
  const cases = useMyCases()
  const now = new Date()

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4 px-5 py-8 lg:max-w-3xl">
      <h1 className="m-0 text-3xl font-extrabold">{t('mine.title')}</h1>
      {cases.isPending ? (
        <div className="flex flex-col gap-3" role="status" aria-label={t('mine.loading')}>
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      ) : cases.isError ? (
        <Message
          icon={<WifiOff aria-hidden="true" className="size-10" />}
          title={t('mine.load_failed')}
          action={<Button onClick={() => cases.refetch()}>{t('common.retry')}</Button>}
        >
          {t('common.check_connection')}
        </Message>
      ) : cases.data.length === 0 ? (
        <Message
          icon={<FilePlus2 aria-hidden="true" className="size-10" />}
          title={t('mine.empty_title')}
          action={publishLink(
            t('mine.publish'),
            'flex min-h-12 items-center justify-center rounded-2xl bg-brand px-5 font-bold text-white no-underline',
          )}
        >
          {t('mine.empty_hint')}
        </Message>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {cases.data.map((item) => (
            <li key={item.code}>
              {caseLink(
                item.code,
                <Row item={item} now={now} />,
                'block text-inherit no-underline',
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Row({ item, now }: { item: MyCase; now: Date }) {
  const i18n = useI18n()
  const { t } = i18n
  // An active found case is not a search: it says what it is.
  const known =
    item.vertical === 'found' && item.status === 'active'
      ? { tone: 'found' as const, label: 'mine.status.found_active' as const }
      : statusBadge[item.status]
  const badge = known
    ? { tone: known.tone, label: t(known.label) }
    : { tone: 'info' as const, label: item.status }
  return (
    <article className="flex items-center gap-4 rounded-2xl bg-surface p-3 shadow-md">
      {item.photoUrl ? (
        <img src={item.photoUrl} alt="" className="size-20 shrink-0 rounded-xl object-cover" />
      ) : (
        <div className="size-20 shrink-0 rounded-xl bg-soft" />
      )}
      <div className="flex min-w-0 flex-col items-start gap-1">
        <div className="flex flex-wrap gap-1">
          <Badge tone={badge.tone}>{badge.label}</Badge>
          {item.status === 'active' && item.openClaimCount > 0 ? (
            <Badge tone="info">
              {t(item.vertical === 'found' ? 'mine.possible_owner' : 'mine.possible_find')}
            </Badge>
          ) : null}
        </div>
        <h2 className="m-0 text-xl font-extrabold">{item.title}</h2>
        <p className="m-0 text-muted">
          {item.placeName} · {i18n.relative(item.publishedAt, now)}
        </p>
      </div>
    </article>
  )
}
