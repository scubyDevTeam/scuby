import { caseQuery } from '@api-client/cases'
import { useSession } from '@api-client/session'
import { PublishAdoption } from '@features/adoption/PublishAdoption'
import { useI18n } from '@i18n/react'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { Button } from '@ui/Button'
import { Message, Skeleton } from '@ui/States'
import { WifiOff } from 'lucide-react'
import { env } from '../../../env'
import { needsWords } from '../../-i18n'
import { LegalLine } from '../../-legal'

/** `?desde=C4STD`: the found case this listing converts (docs/product/05 · the day-15 offer). */
type Search = { desde?: string }

export const Route = createFileRoute('/{-$locale}/_auth/publicar/adopcion')({
  validateSearch: (search: Record<string, unknown>): Search =>
    typeof search.desde === 'string' ? { desde: search.desde } : {},
  beforeLoad: needsWords('publish', 'push', 'adoption', 'adoption_forms'),
  component: PublishAdoptionScreen,
})

/** The SMS code the emulated backend accepts (src/mocks/handlers.ts). */
const DEMO_CODE = '123456'

function PublishAdoptionScreen() {
  const { t } = useI18n()
  const user = useSession().data
  const navigate = useNavigate()
  const { desde } = Route.useSearch()
  const from = useQuery({ ...caseQuery(desde ?? ''), enabled: Boolean(desde) })
  if (!user) return null

  if (desde && from.isPending) {
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
  if (desde && from.isError) {
    return (
      <Message
        icon={<WifiOff aria-hidden="true" className="size-10" />}
        title={t('case.load_failed')}
        action={<Button onClick={() => from.refetch()}>{t('common.retry')}</Button>}
      >
        {t('common.check_connection')}
      </Message>
    )
  }
  // Only the custodian converts their own found case; anything else starts a fresh listing.
  const found =
    desde && from.data?.vertical === 'found' && from.data.viewer === 'custodian' ? from.data : null

  return (
    <PublishAdoption
      key={found?.code ?? 'new'}
      user={user}
      fromFound={found}
      mapStyleUrl={env.mapStyleUrl}
      demoCode={env.apiMock ? DEMO_CODE : undefined}
      legal={<LegalLine />}
      onExit={() =>
        found
          ? navigate({ to: '/{-$locale}/c/$code', params: { code: found.code } })
          : navigate({ to: '/{-$locale}/publicar' })
      }
      caseLink={(code, children, className) => (
        <Link to="/{-$locale}/c/$code" params={{ code }} className={className}>
          {children}
        </Link>
      )}
    />
  )
}
