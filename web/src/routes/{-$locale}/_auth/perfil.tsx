import { useSession } from '@api-client/session'
import { Profile } from '@features/auth/Profile'
import { createFileRoute } from '@tanstack/react-router'
import { LanguageLinks } from '../../-i18n'

export const Route = createFileRoute('/{-$locale}/_auth/perfil')({ component: ProfileScreen })

function ProfileScreen() {
  const user = useSession().data
  if (!user) return null
  return (
    <>
      <Profile user={user} />
      <div className="mx-auto max-w-lg px-5 pb-8">
        <LanguageLinks className="font-bold text-brand-deep" />
      </div>
    </>
  )
}
