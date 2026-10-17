import { Inbox } from '@features/inbox/Inbox'
import { type InboxTab, InboxTabs } from '@features/inbox/InboxTabs'
import { withMessages } from '@i18n/locales'
import { createFileRoute, Link } from '@tanstack/react-router'
import { lazy, type ReactNode, Suspense } from 'react'
import { needsWords } from '../../-i18n'

type Search = { pestana?: 'mensajes' }

// The chat's list and its words arrive with the tab: the notices are what the inbox opens on.
const MessagesTab = lazy(
  withMessages(['chat'], () =>
    import('@features/chat/MessagesTab').then((m) => ({ default: m.MessagesTab })),
  ),
)

export const Route = createFileRoute('/{-$locale}/_auth/bandeja')({
  validateSearch: (search): Search =>
    search.pestana === 'mensajes' ? { pestana: 'mensajes' } : {},
  beforeLoad: needsWords('chat'),
  component: Bandeja,
})

const tabLink = (tab: InboxTab, children: ReactNode, className: string) => (
  <Link
    key={tab}
    to="/{-$locale}/bandeja"
    search={tab === 'messages' ? { pestana: 'mensajes' } : {}}
    className={className}
  >
    {children}
  </Link>
)

function Bandeja() {
  const { pestana } = Route.useSearch()
  const caseLink = (code: string, children: ReactNode, className: string) => (
    <Link to="/{-$locale}/c/$code" params={{ code }} className={className}>
      {children}
    </Link>
  )
  if (pestana === 'mensajes') {
    return (
      <Suspense fallback={null}>
        <MessagesTab
          tabLink={tabLink}
          threadLink={(id, children, className) => (
            <Link
              to="/{-$locale}/mensajes/$conversation"
              params={{ conversation: id }}
              className={className}
            >
              {children}
            </Link>
          )}
        />
      </Suspense>
    )
  }
  return <Inbox caseLink={caseLink} tabs={<InboxTabs current="notices" tabLink={tabLink} />} />
}
