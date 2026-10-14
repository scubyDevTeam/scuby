import { useI18n } from '@i18n/react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { Message } from '@ui/States'
import type { ReactNode } from 'react'

// The doors whose flow is not built yet. «perdido» has its own route and never lands here.
export const Route = createFileRoute('/{-$locale}/publicar/$tipo')({ component: Unfinished })

function Unfinished() {
  const { t, rich } = useI18n()
  return (
    <Message title={t('app.unfinished_door.title')}>
      {rich('app.unfinished_door.body', {
        back: (chunks: ReactNode) => (
          <Link to="/{-$locale}/publicar" className="font-bold text-brand-deep">
            {chunks}
          </Link>
        ),
      })}
    </Message>
  )
}
