import { useCase } from '@api-client/cases'
import { ApiError } from '@api-client/http'
import { createFileRoute, Link } from '@tanstack/react-router'
import { Button } from '@ui/Button'
import { Message, Skeleton } from '@ui/States'
import { FileX, SearchX, WifiOff } from 'lucide-react'
import { lazy, Suspense } from 'react'

export const Route = createFileRoute('/c/$code')({ component: CaseScreen })

// One vertical per case: a link to a lost pet must not download the found page, and vice versa.
const LostCaseScreen = lazy(() =>
  import('./-case/LostCaseScreen').then((m) => ({ default: m.LostCaseScreen })),
)
const FoundCaseScreen = lazy(() =>
  import('./-case/FoundCaseScreen').then((m) => ({ default: m.FoundCaseScreen })),
)

const homeLink = (
  <Link to="/" className="font-bold text-brand-deep">
    Ver otros avisos
  </Link>
)

const loading = (
  <div className="mx-auto max-w-lg" role="status" aria-label="Cargando aviso">
    <Skeleton className="aspect-square rounded-none" />
    <div className="flex flex-col gap-3 p-5">
      <Skeleton className="h-10 w-1/2" />
      <Skeleton className="h-6" />
      <Skeleton className="h-14" />
    </div>
  </div>
)

function CaseScreen() {
  const { code } = Route.useParams()
  const query = useCase(code)

  if (query.isPending) return loading

  if (query.isError) {
    const kind = query.error instanceof ApiError ? query.error.kind : 'server'
    // docs/product/10 §1: a purged code still resolves, so a printed poster never 404s.
    if (kind === 'gone') {
      return (
        <Message
          icon={<FileX aria-hidden="true" className="size-10" />}
          title="Este aviso ya no está disponible"
        >
          {homeLink}
        </Message>
      )
    }
    if (kind === 'not_found') {
      return (
        <Message
          icon={<SearchX aria-hidden="true" className="size-10" />}
          title="No encontramos este aviso"
        >
          Revisa que el código del enlace esté completo. {homeLink}
        </Message>
      )
    }
    return (
      <Message
        icon={<WifiOff aria-hidden="true" className="size-10" />}
        title="No pudimos cargar el aviso"
        action={<Button onClick={() => query.refetch()}>Reintentar</Button>}
      >
        Revisa tu conexión e inténtalo de nuevo.
      </Message>
    )
  }

  const found = query.data
  if (found.vertical === 'lost' || found.vertical === 'found') {
    return (
      <Suspense fallback={loading}>
        {found.vertical === 'lost' ? (
          <LostCaseScreen found={found} />
        ) : (
          <FoundCaseScreen found={found} />
        )}
      </Suspense>
    )
  }
  return (
    <Message title={found.title}>
      {found.placeName}. Estamos terminando esta página. {homeLink}
    </Message>
  )
}
