import { useSession } from '@api-client/session'
import { Profile } from '@features/auth/Profile'
import { createFileRoute } from '@tanstack/react-router'
import { env } from '../../../env'
import { ResetDemo } from '../../-demo'
import { LanguageLinks } from '../../-i18n'

export const Route = createFileRoute('/{-$locale}/_auth/perfil')({ component: ProfileScreen })

function ProfileScreen() {
  // The gate above already waited for the session; the profile itself is fetched by the screen.
  if (!useSession().data) return null
  return (
    <>
      <Profile mapStyleUrl={env.mapStyleUrl} demoCode={env.apiMock ? '123456' : undefined} />
      <div className="mx-auto flex max-w-lg flex-col gap-4 px-5 pb-8">
        <LanguageLinks className="font-bold text-brand-deep" />
        <ResetDemo />
      </div>
    </>
  )
}
