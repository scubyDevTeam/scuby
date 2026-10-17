import { ConversationPage } from '@features/chat/ConversationPage'
import { useI18n } from '@i18n/react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { roundButtonClass } from '@ui/Button'
import { ChevronLeft } from 'lucide-react'
import type { ReactNode } from 'react'
import { needsWords } from '../../-i18n'

export const Route = createFileRoute('/{-$locale}/_auth/mensajes/$conversation')({
  // Inline, so the route's own params (the thread) are still inferred.
  beforeLoad: ({ params }) => needsWords('chat')({ params }),
  component: Thread,
})

function Thread() {
  const { conversation } = Route.useParams()
  const { t } = useI18n()
  return (
    <ConversationPage
      id={conversation}
      backLink={
        <Link
          to="/{-$locale}/bandeja"
          search={{ pestana: 'mensajes' }}
          aria-label={t('chat.thread.back')}
          className={roundButtonClass}
        >
          <ChevronLeft aria-hidden="true" />
        </Link>
      }
      caseLink={(code: string, children: ReactNode, className: string) => (
        <Link to="/{-$locale}/c/$code" params={{ code }} className={className}>
          {children}
        </Link>
      )}
    />
  )
}
