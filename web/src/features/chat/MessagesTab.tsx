import { type InboxTab, InboxTabs } from '@features/inbox/InboxTabs'
import { useI18n } from '@i18n/react'
import type { ReactNode } from 'react'
import { ConversationList } from './ConversationList'

type Props = {
  threadLink: (id: string, children: ReactNode, className: string) => ReactNode
  tabLink: (tab: InboxTab, children: ReactNode, className: string) => ReactNode
}

/** The inbox's «Mensajes» tab: the page frame around the list of threads. */
export function MessagesTab({ threadLink, tabLink }: Props) {
  const { t } = useI18n()
  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4 px-5 py-8 lg:max-w-3xl">
      <h1 className="m-0 text-3xl font-extrabold">{t('inbox.title')}</h1>
      <InboxTabs current="messages" tabLink={tabLink} />
      <ConversationList threadLink={threadLink} />
    </div>
  )
}
