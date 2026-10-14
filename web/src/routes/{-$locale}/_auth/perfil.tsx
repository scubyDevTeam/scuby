import { useSession } from '@api-client/session'
import { Profile } from '@features/auth/Profile'
import { createFileRoute } from '@tanstack/react-router'
import { LanguageLinks } from '../../-i18n'

export const Route = createFileRoute('/{-$locale}/_auth/perfil')({ component: ProfileScreen })

function ProfileScreen() {
  // The gate above already waited for the session; the profile itself is fetched by the screen.
  if (!useSession().data) return null
  return (
    <>
      <Profile />
      <div className="mx-auto max-w-lg px-5 pb-8">
        <LanguageLinks className="font-bold text-brand-deep" />
      </div>
    </>
  )
}
