import { useSession } from '@api-client/session'
import { SignIn } from '@features/auth/SignIn'
import { useI18n } from '@i18n/react'
import { createFileRoute, Outlet } from '@tanstack/react-router'
import { Button } from '@ui/Button'
import { Message, Skeleton } from '@ui/States'
import { WifiOff } from 'lucide-react'
import { env } from '../../env'
import { LanguageLinks } from '../-i18n'

/** The code the emulated backend accepts (src/mocks/handlers.ts). Shown only while mocks are on. */
const DEMO_CODE = '123456'

// Session required (frontend.md · Folder structure). There is no signup screen: whoever lands
// here without a session signs in on the spot and continues to where they were going.
export const Route = createFileRoute('/{-$locale}/_auth')({ component: Gate })

function Gate() {
  const { t } = useI18n()
  const session = useSession()

  if (session.isPending) {
    return (
      <div
        className="mx-auto flex max-w-lg flex-col gap-3 p-5"
        role="status"
        aria-label={t('common.loading')}
      >
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-40" />
      </div>
    )
  }
  if (session.isError) {
    return (
      <Message
        icon={<WifiOff aria-hidden="true" className="size-10" />}
        title={t('app.gate.checking')}
        action={<Button onClick={() => session.refetch()}>{t('common.retry')}</Button>}
      >
        {t('common.check_connection')}
      </Message>
    )
  }
  if (session.data) return <Outlet />

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4 px-5 py-8">
      <h1 className="m-0 text-3xl font-extrabold">{t('app.gate.title')}</h1>
      <SignIn
        googleClientId={env.googleClientId}
        demoCode={env.apiMock ? DEMO_CODE : undefined}
        legal={t('app.legal')}
      />
      <LanguageLinks className="font-bold text-brand-deep" />
    </div>
  )
}
