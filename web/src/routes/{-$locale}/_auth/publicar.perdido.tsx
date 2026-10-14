import { useSession } from '@api-client/session'
import { PublishLost } from '@features/lost/PublishLost'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { env } from '../../../env'
import { needsWords } from '../../-i18n'
import { LegalLine } from '../../-legal'

export const Route = createFileRoute('/{-$locale}/_auth/publicar/perdido')({
  beforeLoad: needsWords('publish', 'push'),
  component: PublishLostScreen,
})

/** The SMS code the emulated backend accepts (src/mocks/handlers.ts). */
const DEMO_CODE = '123456'

function PublishLostScreen() {
  const user = useSession().data
  const navigate = useNavigate()
  if (!user) return null
  return (
    <PublishLost
      user={user}
      mapStyleUrl={env.mapStyleUrl}
      demoCode={env.apiMock ? DEMO_CODE : undefined}
      legal={<LegalLine />}
      onExit={() => navigate({ to: '/{-$locale}/publicar' })}
      caseLink={(code, children, className) => (
        <Link to="/{-$locale}/c/$code" params={{ code }} className={className}>
          {children}
        </Link>
      )}
    />
  )
}
