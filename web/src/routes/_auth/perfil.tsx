import { useSession } from '@api-client/session'
import { Profile } from '@features/auth/Profile'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_auth/perfil')({ component: ProfileScreen })

function ProfileScreen() {
  const user = useSession().data
  return user ? <Profile user={user} /> : null
}
