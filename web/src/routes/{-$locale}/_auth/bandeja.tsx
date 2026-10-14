import { useI18n } from '@i18n/react'
import { createFileRoute } from '@tanstack/react-router'
import { Message } from '@ui/States'

export const Route = createFileRoute('/{-$locale}/_auth/bandeja')({ component: Inbox })

function Inbox() {
  const { t } = useI18n()
  return <Message title={t('app.inbox.title')}>{t('app.inbox.empty')}</Message>
}
