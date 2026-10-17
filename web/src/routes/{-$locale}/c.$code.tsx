import { useCase } from '@api-client/cases'
import { ApiError } from '@api-client/http'
import { withMessages } from '@i18n/locales'
import { useI18n } from '@i18n/react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { Button } from '@ui/Button'
import { Message, Skeleton } from '@ui/States'
import { FileX, SearchX, WifiOff } from 'lucide-react'
import { lazy, type ReactNode, Suspense } from 'react'
import { ResetDemo } from '../-demo'

export const Route = createFileRoute('/{-$locale}/c/$code')({ component: CaseScreen })

// One vertical per case: a link to a lost pet must not download the found page, and vice versa.
const LostCaseScreen = lazy(() =>
  import('./-case/LostCaseScreen').then((m) => ({ default: m.LostCaseScreen })),
)
const FoundCaseScreen = lazy(
  withMessages(['found'], () =>
    import('./-case/FoundCaseScreen').then((m) => ({ default: m.FoundCaseScreen })),
  ),
)
// Its words come with it: they are not part of the first paint of every other case.
const AdoptionCaseScreen = lazy(
  withMessages(['adoption'], () =>
    import('./-case/AdoptionCaseScreen').then((m) => ({ default: m.AdoptionCaseScreen })),
  ),
)
const HelpCaseScreen = lazy(
  withMessages(['help'], () =>
    import('./-case/HelpCaseScreen').then((m) => ({ default: m.HelpCaseScreen })),
  ),
)

const home = (chunks: ReactNode) => (
  <Link to="/{-$locale}" className="font-bold text-brand-deep">
    {chunks}
  </Link>
)

function Loading() {
  const { t } = useI18n()
  return (
    <div className="mx-auto max-w-lg" role="status" aria-label={t('case.loading')}>
      <Skeleton className="aspect-square rounded-none" />
      <div className="flex flex-col gap-3 p-5">
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="h-6" />
        <Skeleton className="h-14" />
      </div>
    </div>
  )
}

function CaseScreen() {
  const { t, rich } = useI18n()
  const { code } = Route.useParams()
  const query = useCase(code)

  if (query.isPending) return <Loading />

  if (query.isError) {
    const kind = query.error instanceof ApiError ? query.error.kind : 'server'
    // docs/product/10 §1: a purged code still resolves, so a printed poster never 404s.
    if (kind === 'gone') {
      return (
        <Message icon={<FileX aria-hidden="true" className="size-10" />} title={t('case.gone')}>
          {home(t('case.other_cases'))}
        </Message>
      )
    }
    if (kind === 'not_found') {
      return (
        <Message
          icon={<SearchX aria-hidden="true" className="size-10" />}
          title={t('case.not_found')}
        >
          {rich('case.not_found_hint', { home })}
        </Message>
      )
    }
    return (
      <Message
        icon={<WifiOff aria-hidden="true" className="size-10" />}
        title={t('case.load_failed')}
        action={
          <>
            <Button onClick={() => query.refetch()}>{t('common.retry')}</Button>
            <ResetDemo />
          </>
        }
      >
        {/* «Revisa tu conexión» only when there was no answer at all: a server that failed is ours. */}
        {kind === 'network' ? t('common.check_connection') : t('common.server_failed')}
      </Message>
    )
  }

  const found = query.data
  return (
    <Suspense fallback={<Loading />}>
      {found.vertical === 'lost' ? (
        <LostCaseScreen found={found} />
      ) : found.vertical === 'found' ? (
        <FoundCaseScreen found={found} />
      ) : found.vertical === 'adoption' ? (
        <AdoptionCaseScreen found={found} />
      ) : (
        <HelpCaseScreen found={found} />
      )}
    </Suspense>
  )
}
