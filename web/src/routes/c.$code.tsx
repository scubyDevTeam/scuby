import { useCase } from '@api-client/cases'
import { ApiError } from '@api-client/http'
import type { LostAction } from '@domain/lost/actions'
import { LostCasePage } from '@features/lost/LostCasePage'
import { shareLink } from '@platform/share'
import { createFileRoute, Link } from '@tanstack/react-router'
import { Button, roundButtonClass } from '@ui/Button'
import { Sheet } from '@ui/Sheet'
import { Message, Skeleton } from '@ui/States'
import { ChevronLeft, FileX, SearchX, WifiOff } from 'lucide-react'
import { useState } from 'react'
import { brand } from '../brand'

export const Route = createFileRoute('/c/$code')({ component: CaseScreen })

const homeLink = (
  <Link to="/" className="font-bold text-brand-deep">
    Ver otros avisos
  </Link>
)

function CaseScreen() {
  const { code } = Route.useParams()
  const query = useCase(code)
  const [sheet, setSheet] = useState<'copied' | 'pending' | null>(null)

  if (query.isPending) {
    return (
      <div className="mx-auto max-w-lg" role="status" aria-label="Cargando aviso">
        <Skeleton className="aspect-square rounded-none" />
        <div className="flex flex-col gap-3 p-5">
          <Skeleton className="h-10 w-1/2" />
          <Skeleton className="h-6" />
          <Skeleton className="h-14" />
        </div>
      </div>
    )
  }

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
  const url = `${brand.origin}/c/${found.code}`

  if (found.vertical !== 'lost') {
    return (
      <Message title={found.title}>
        {found.placeName}. Estamos terminando esta página. {homeLink}
      </Message>
    )
  }

  async function handle(action: LostAction) {
    if (action !== 'share') return setSheet('pending')
    const result = await shareLink({
      title: `Se busca: ${found.vertical === 'lost' ? found.pet.name : ''}`,
      text: 'Ayúdanos a encontrarla',
      url,
    })
    if (result === 'copied') setSheet('copied')
  }

  return (
    <>
      <LostCasePage
        lostCase={found}
        now={new Date()}
        shortUrl={`${new URL(brand.origin).host}/c/${found.code}`}
        backLink={
          <Link to="/" aria-label="Volver al inicio" className={roundButtonClass}>
            <ChevronLeft aria-hidden="true" />
          </Link>
        }
        onAction={handle}
      />
      <Sheet
        open={sheet !== null}
        onClose={() => setSheet(null)}
        title={sheet === 'copied' ? 'Enlace copiado' : 'Todavía no está lista'}
      >
        <p className="m-0 text-muted">
          {sheet === 'copied'
            ? 'Pégalo en WhatsApp o donde quieras compartirlo.'
            : 'Estamos construyendo esta parte. Mientras tanto puedes escribirle a su familia.'}
        </p>
        <Button onClick={() => setSheet(null)}>Entendido</Button>
      </Sheet>
    </>
  )
}
