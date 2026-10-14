import { useSession } from '@api-client/session'
import { PublishFound } from '@features/found/PublishFound'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { env } from '../../env'

export const Route = createFileRoute('/_auth/publicar/encontrado/aviso')({
  component: PublishFoundScreen,
})

/** The SMS code the emulated backend accepts (src/mocks/handlers.ts). */
const DEMO_CODE = '123456'

function PublishFoundScreen() {
  const user = useSession().data
  const navigate = useNavigate()
  if (!user) return null
  return (
    <PublishFound
      user={user}
      mapStyleUrl={env.mapStyleUrl}
      demoCode={env.apiMock ? DEMO_CODE : undefined}
      onExit={() => navigate({ to: '/publicar' })}
      caseLink={(code, children, className) => (
        <Link to="/c/$code" params={{ code }} className={className}>
          {children}
        </Link>
      )}
    />
  )
}
