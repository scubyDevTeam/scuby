import { useStartConversation } from '@api-client/conversations'
import { ApiError } from '@api-client/http'
import { MAX_MESSAGE_LENGTH, messageProblem } from '@domain/chat/messages'
import { useI18n } from '@i18n/react'
import { Button } from '@ui/Button'
import { TextArea } from '@ui/Field'
import { Notice } from '@ui/Notice'
import { type FormEvent, type ReactNode, useState } from 'react'

type Props = {
  code: string
  /** Who answers for the case, as the page names them. */
  name: string
  /** Where the sent thread lives: a link from the router. */
  threadLink: (id: string, children: ReactNode, className: string) => ReactNode
  onDone: () => void
}

/** «Escribirle por chat»: the first message, and the thread is born with it (comms.md rule 1). */
export function StartChat({ code, name, threadLink, onDone }: Props) {
  const { t } = useI18n()
  const start = useStartConversation(code)
  const [text, setText] = useState('')
  const [tried, setTried] = useState(false)
  const problem = messageProblem(text)

  if (start.data) {
    return (
      <div className="flex flex-col gap-4">
        <Notice tone="success" title={t('chat.start.sent_title')}>
          {t('chat.start.sent_body', { name })}
        </Notice>
        {threadLink(
          start.data.id,
          t('chat.start.see_thread'),
          'flex min-h-12 items-center justify-center rounded-2xl bg-brand px-5 font-bold text-white no-underline',
        )}
        <Button variant="secondary" onClick={onDone}>
          {t('common.done')}
        </Button>
      </div>
    )
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    setTried(true)
    if (problem) return
    start.mutate(text.trim())
  }

  const refused = start.error instanceof ApiError ? start.error : null
  const failure = start.isError
    ? refused?.kind === 'forbidden'
      ? t('chat.start.errors.own')
      : refused?.kind === 'conflict'
        ? t('chat.start.errors.ended')
        : t('chat.start.errors.generic')
    : null
  const error =
    tried && problem === 'empty'
      ? t('chat.start.errors.empty')
      : tried && problem === 'too_long'
        ? t('chat.start.errors.too_long', { max: MAX_MESSAGE_LENGTH })
        : failure

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <p className="m-0 text-muted">{t('chat.start.intro', { name })}</p>
      <TextArea
        label={t('chat.start.label')}
        placeholder={t('chat.start.placeholder')}
        value={text}
        error={error}
        onChange={(event) => setText(event.target.value)}
      />
      <Button type="submit" disabled={start.isPending}>
        {t('chat.start.send')}
      </Button>
    </form>
  )
}
