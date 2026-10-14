import { useNotifications, useReadNotifications } from '@api-client/owner'
import type { Notification } from '@contracts/owner'
import { useI18n } from '@i18n/react'
import { Button } from '@ui/Button'
import { Message, Skeleton } from '@ui/States'
import { BellOff, WifiOff } from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'

type Props = {
  caseLink: (code: string, children: ReactNode, className: string) => ReactNode
}

/** The in-app inbox: a copy of every notification sent to this account (docs/product/08), newest first. */
export function Inbox({ caseLink }: Props) {
  const { t } = useI18n()
  const notifications = useNotifications()
  const { mutate: markRead } = useReadNotifications()
  // Opening the inbox reads what it shows: the unread ones on screen are marked read at once, by
  // id — never «all», so one that arrives meanwhile stays unread. They keep looking unread for the
  // rest of this visit, so the person still sees what was new.
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set())
  const marked = useRef(false)
  const data = notifications.data
  useEffect(() => {
    if (!data || marked.current) return
    marked.current = true
    const unread = data.items.filter((n) => !n.readAt).map((n) => n.id)
    if (unread.length === 0) return
    setFresh(new Set(unread))
    markRead(unread)
  }, [data, markRead])
  const now = new Date()

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4 px-5 py-8 lg:max-w-3xl">
      <h1 className="m-0 text-3xl font-extrabold">{t('inbox.title')}</h1>
      {notifications.isPending ? (
        <div className="flex flex-col gap-3" role="status" aria-label={t('inbox.loading')}>
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      ) : notifications.isError ? (
        <Message
          icon={<WifiOff aria-hidden="true" className="size-10" />}
          title={t('inbox.load_failed')}
          action={<Button onClick={() => notifications.refetch()}>{t('common.retry')}</Button>}
        >
          {t('common.check_connection')}
        </Message>
      ) : notifications.data.items.length === 0 ? (
        <Message
          icon={<BellOff aria-hidden="true" className="size-10" />}
          title={t('inbox.empty_title')}
        >
          {t('inbox.empty_hint')}
        </Message>
      ) : (
        <ul
          aria-label={t('inbox.list_label')}
          className="m-0 flex list-none flex-col overflow-hidden rounded-2xl bg-surface p-0 shadow-md"
        >
          {notifications.data.items.map((item) => {
            const row = <Row item={item} unread={!item.readAt || fresh.has(item.id)} now={now} />
            return (
              <li key={item.id} className="border-b border-line last:border-b-0">
                {item.caseCode
                  ? caseLink(item.caseCode, row, 'block text-inherit no-underline')
                  : row}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function Row({ item, unread, now }: { item: Notification; unread: boolean; now: Date }) {
  const i18n = useI18n()
  return (
    <article
      data-unread={unread}
      className={`flex items-start gap-3 p-4 ${unread ? 'bg-brand-ice' : ''}`}
    >
      <span
        aria-hidden="true"
        className={`mt-2 size-2.5 shrink-0 rounded-full ${unread ? 'bg-brand' : 'bg-line'}`}
      />
      <p className={`m-0 min-w-0 flex-1 ${unread ? 'font-bold' : 'text-muted'}`}>
        {unread ? <span className="sr-only">{i18n.t('inbox.unread')} </span> : null}
        {item.body}
      </p>
      <time
        dateTime={item.createdAt.toISOString()}
        className={`shrink-0 text-sm ${unread ? 'font-semibold text-brand-deep' : 'text-muted'}`}
      >
        {i18n.relative(item.createdAt, now)}
      </time>
    </article>
  )
}
