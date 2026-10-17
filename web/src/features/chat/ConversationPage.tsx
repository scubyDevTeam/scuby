import {
  useConversation,
  useReadConversation,
  useSendMessage,
  useShareWhatsapp,
} from '@api-client/conversations'
import { ApiError } from '@api-client/http'
import type { ChatMessage, Conversation } from '@contracts/conversations'
import {
  canShareWhatsapp,
  canWrite,
  MAX_MESSAGE_LENGTH,
  messageProblem,
  withDays,
} from '@domain/chat/messages'
import { useI18n } from '@i18n/react'
import { WhatsAppIcon } from '@ui/BrandIcons'
import { Button, buttonClass, roundButtonClass } from '@ui/Button'
import { Message, Skeleton } from '@ui/States'
import { Lock, MessageSquareOff, Send, WifiOff } from 'lucide-react'
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react'

type Props = {
  id: string
  /** Back to the list: a link from the router. */
  backLink: ReactNode
  caseLink: (code: string, children: ReactNode, className: string) => ReactNode
}

/** One thread: the case card, the messages, and the box to answer — or the closed footer. */
export function ConversationPage({ id, backLink, caseLink }: Props) {
  const { t } = useI18n()
  const thread = useConversation(id)
  const { mutate: markRead } = useReadConversation(id)
  const unseen = thread.data?.messages.length

  // Opening a thread reads it, and so does a message that arrives while it is open.
  useEffect(() => {
    if (unseen !== undefined) markRead()
  }, [unseen, markRead])

  if (thread.isPending) {
    return (
      <Shell back={backLink}>
        <div
          className="flex flex-col gap-3 p-5"
          role="status"
          aria-label={t('chat.thread.loading')}
        >
          <Skeleton className="h-20" />
          <Skeleton className="h-12 w-2/3" />
          <Skeleton className="h-12 w-1/2 self-end" />
        </div>
      </Shell>
    )
  }
  if (thread.isError) {
    const gone =
      thread.error instanceof ApiError &&
      (thread.error.kind === 'not_found' || thread.error.kind === 'forbidden')
    return (
      <Shell back={backLink}>
        <Message
          icon={
            gone ? (
              <MessageSquareOff aria-hidden="true" className="size-10" />
            ) : (
              <WifiOff aria-hidden="true" className="size-10" />
            )
          }
          title={gone ? t('chat.thread.not_found') : t('chat.thread.load_failed')}
          action={
            gone ? undefined : <Button onClick={() => thread.refetch()}>{t('common.retry')}</Button>
          }
        >
          {gone ? null : t('common.check_connection')}
        </Message>
      </Shell>
    )
  }
  return <Thread conversation={thread.data} backLink={backLink} caseLink={caseLink} />
}

function Shell({ back, children }: { back: ReactNode; children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-lg flex-col gap-3 px-5 py-6 lg:max-w-2xl">
      <div className="flex">{back}</div>
      {children}
    </div>
  )
}

function Thread({
  conversation,
  backLink,
  caseLink,
}: {
  conversation: Conversation
  backLink: ReactNode
  caseLink: Props['caseLink']
}) {
  const { t, date } = useI18n()
  const bottom = useRef<HTMLDivElement>(null)
  const count = conversation.messages.length
  // The newest message is always in view: a thread is read from the bottom.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scrolls when a message arrives
  useEffect(() => {
    bottom.current?.scrollIntoView?.({ block: 'end' })
  }, [count])

  const closed = conversation.closed
  const card = (
    <div
      className={`flex items-center gap-3 rounded-2xl bg-brand-ice p-3 ${closed ? 'opacity-80' : ''}`}
    >
      {conversation.case.photoUrl ? (
        <img
          src={conversation.case.photoUrl}
          alt=""
          className="size-12 shrink-0 rounded-xl object-cover"
        />
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col">
        <strong className="truncate">{conversation.case.petName ?? ''}</strong>
        <span className="truncate text-sm text-brand-deep">
          {closed
            ? t('chat.thread.closed_card', {
                note: closed.note,
                date: date(closed.at, { day: 'numeric', month: 'short' }),
              })
            : conversation.case.summary}
        </span>
      </div>
      {caseLink(
        conversation.case.code,
        t('chat.thread.see_case'),
        'shrink-0 font-bold text-brand-deep',
      )}
    </div>
  )

  return (
    <Shell back={null}>
      <header className="flex items-center gap-3">
        <span className="shrink-0">{backLink}</span>
        <div className="flex min-w-0 flex-col">
          <h1 className="m-0 truncate text-2xl font-extrabold">{conversation.otherName}</h1>
          <p className="m-0 text-sm text-muted">{t('chat.thread.hidden_number')}</p>
        </div>
      </header>
      {card}
      <ol
        aria-label={t('chat.thread.messages_label')}
        className="m-0 flex list-none flex-col gap-3 p-0"
      >
        {withDays(conversation.messages).map(({ message, showDay }) => (
          <li key={message.id} className="flex flex-col gap-3">
            {showDay ? (
              <p className="m-0 self-center rounded-full bg-soft px-3 py-1 text-sm text-muted">
                {date(message.sentAt, { day: 'numeric', month: 'long' })}
              </p>
            ) : null}
            <Bubble message={message} otherName={conversation.otherName} />
          </li>
        ))}
      </ol>
      <div ref={bottom} />
      {canWrite({ closed: Boolean(closed) }) ? (
        <Composer conversation={conversation} />
      ) : (
        <p className="m-0 flex items-center gap-2 rounded-2xl bg-soft p-4 text-muted">
          <Lock aria-hidden="true" className="size-5 shrink-0" />
          {t('chat.thread.closed_footer')}
        </p>
      )}
    </Shell>
  )
}

function Bubble({ message, otherName }: { message: ChatMessage; otherName: string }) {
  const { t, date } = useI18n()
  const time = (
    <time dateTime={message.sentAt.toISOString()} className="text-xs text-muted">
      {date(message.sentAt, { hour: 'numeric', minute: '2-digit', hour12: true })}
    </time>
  )

  if (message.kind === 'automatic') {
    return (
      <article className="flex flex-col gap-2 rounded-2xl border-2 border-brand bg-surface p-4">
        {message.label ? (
          <p className="m-0 text-xs font-bold tracking-wide text-brand-deep uppercase">
            {message.label}
          </p>
        ) : null}
        <p className="m-0">{message.body}</p>
        {message.photoUrls.length > 0 ? (
          <div className="flex gap-2">
            {message.photoUrls.map((url) => (
              <img key={url} src={url} alt="" className="size-16 rounded-xl object-cover" />
            ))}
          </div>
        ) : null}
      </article>
    )
  }
  if (message.kind === 'whatsapp') {
    return (
      <article
        className={`flex max-w-[85%] flex-col gap-2 rounded-2xl bg-brand-mist p-4 ${message.mine ? 'self-end' : 'self-start'}`}
      >
        <p className="m-0 font-bold text-found">
          {message.mine
            ? t('chat.thread.you_gave_whatsapp')
            : t('chat.thread.gave_whatsapp', { name: otherName })}
        </p>
        {message.phone ? <p className="m-0 font-mono text-lg">{message.phone}</p> : null}
        {!message.mine && message.whatsappUrl ? (
          <a
            href={message.whatsappUrl}
            target="_blank"
            rel="noreferrer"
            className={buttonClass('whatsapp', 'lg:w-auto')}
          >
            <WhatsAppIcon />
            {t('chat.thread.open_whatsapp')}
          </a>
        ) : null}
        {time}
      </article>
    )
  }
  return (
    <div
      className={`flex max-w-[85%] flex-col gap-1 ${message.mine ? 'items-end self-end' : 'items-start self-start'}`}
    >
      <p
        className={`m-0 rounded-2xl px-4 py-3 break-words ${message.mine ? 'bg-brand text-white' : 'bg-soft'}`}
      >
        {message.body}
      </p>
      {time}
    </div>
  )
}

function Composer({ conversation }: { conversation: Conversation }) {
  const { t } = useI18n()
  const send = useSendMessage(conversation.id)
  const share = useShareWhatsapp(conversation.id)
  const [text, setText] = useState('')
  const [tried, setTried] = useState(false)
  const problem = messageProblem(text)

  function submit(event: FormEvent) {
    event.preventDefault()
    setTried(true)
    if (problem) return
    send.mutate(text.trim(), {
      onSuccess: () => {
        setText('')
        setTried(false)
      },
    })
  }

  return (
    <div className="sticky bottom-0 flex flex-col gap-2 bg-surface pb-2">
      {canShareWhatsapp({
        closed: Boolean(conversation.closed),
        canShareWhatsapp: conversation.canShareWhatsapp,
      }) ? (
        <div className="flex flex-col items-start gap-1">
          <Button
            variant="outline"
            className="w-auto"
            disabled={share.isPending}
            onClick={() => share.mutate()}
          >
            <WhatsAppIcon className="size-5" />
            {t('chat.thread.give_whatsapp')}
          </Button>
          <p className="m-0 text-sm text-muted">{t('chat.thread.give_whatsapp_hint')}</p>
        </div>
      ) : null}
      {send.isError || share.isError ? (
        <p role="alert" className="m-0 text-sm font-semibold text-lost-deep">
          {t('chat.thread.send_failed')}
        </p>
      ) : null}
      {tried && problem === 'too_long' ? (
        <p role="alert" className="m-0 text-sm font-semibold text-lost-deep">
          {t('chat.thread.too_long', { max: MAX_MESSAGE_LENGTH })}
        </p>
      ) : null}
      <form onSubmit={submit} noValidate className="flex items-center gap-2">
        <input
          aria-label={t('chat.thread.composer_label')}
          placeholder={t('chat.thread.composer_placeholder')}
          value={text}
          onChange={(event) => setText(event.target.value)}
          className="min-h-12 min-w-0 flex-1 rounded-full border-2 border-field bg-surface px-4 text-base"
        />
        <button
          type="submit"
          aria-label={t('chat.thread.send')}
          disabled={send.isPending}
          className={`${roundButtonClass} bg-brand text-white disabled:opacity-50`}
        >
          <Send aria-hidden="true" />
        </button>
      </form>
    </div>
  )
}
