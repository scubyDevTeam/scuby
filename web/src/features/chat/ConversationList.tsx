import { useConversations } from '@api-client/conversations'
import type { ConversationItem } from '@contracts/conversations'
import { useI18n } from '@i18n/react'
import { Button } from '@ui/Button'
import { Message, Skeleton } from '@ui/States'
import { MessageSquare, WifiOff } from 'lucide-react'
import type { ReactNode } from 'react'

type Props = {
  threadLink: (id: string, children: ReactNode, className: string) => ReactNode
}

/** The «Mensajes» tab of the inbox: every thread this account is in, closed ones last. */
export function ConversationList({ threadLink }: Props) {
  const { t, relative } = useI18n()
  const conversations = useConversations()
  const now = new Date()

  if (conversations.isPending) {
    return (
      <div className="flex flex-col gap-3" role="status" aria-label={t('chat.loading')}>
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
      </div>
    )
  }
  if (conversations.isError) {
    return (
      <Message
        icon={<WifiOff aria-hidden="true" className="size-10" />}
        title={t('chat.load_failed')}
        action={<Button onClick={() => conversations.refetch()}>{t('common.retry')}</Button>}
      >
        {t('common.check_connection')}
      </Message>
    )
  }
  if (conversations.data.items.length === 0) {
    return (
      <Message
        icon={<MessageSquare aria-hidden="true" className="size-10" />}
        title={t('chat.empty_title')}
      >
        {t('chat.empty_hint')}
      </Message>
    )
  }
  return (
    <ul
      aria-label={t('chat.list_label')}
      className="m-0 flex list-none flex-col overflow-hidden rounded-2xl bg-surface p-0 shadow-md"
    >
      {conversations.data.items.map((item) => (
        <li key={item.id} className="border-b border-line last:border-b-0">
          {threadLink(
            item.id,
            <Row item={item} when={relative(item.lastAt, now)} />,
            'block text-inherit no-underline',
          )}
        </li>
      ))}
    </ul>
  )
}

function Row({ item, when }: { item: ConversationItem; when: string }) {
  const { t } = useI18n()
  const unread = item.unreadCount > 0
  return (
    <article
      data-unread={unread}
      className={`flex items-center gap-3 p-4 ${item.closed ? 'opacity-70' : ''}`}
    >
      {item.photoUrl ? (
        <img src={item.photoUrl} alt="" className="size-12 shrink-0 rounded-2xl object-cover" />
      ) : (
        <span aria-hidden="true" className="size-12 shrink-0 rounded-2xl bg-soft" />
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="m-0 truncate text-base font-bold">{item.otherName}</h2>
          <time dateTime={item.lastAt.toISOString()} className="shrink-0 text-sm text-muted">
            {when}
          </time>
        </div>
        <p className="m-0 truncate text-sm text-muted">
          {item.topic}
          {item.closed ? ` · ${t('chat.closed_tag')}` : ''}
        </p>
        <p className={`m-0 truncate ${unread ? 'font-bold' : 'text-muted'}`}>{item.preview}</p>
      </div>
      {unread ? (
        <span className="inline-flex min-w-6 items-center justify-center rounded-full bg-brand px-1.5 text-sm leading-6 font-bold text-white">
          <span aria-hidden="true">{item.unreadCount}</span>
          <span className="sr-only">{t('chat.unread', { count: item.unreadCount })}</span>
        </span>
      ) : null}
    </article>
  )
}
