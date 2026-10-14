import { useCase } from '@api-client/cases'
import { ApiError } from '@api-client/http'
import type { LostAction } from '@domain/lost/actions'
import { suggestedAttribution } from '@domain/lost/resolution'
import { publicArea } from '@domain/shared/geo'
import { LostCasePage } from '@features/lost/LostCasePage'
import { shareLink } from '@platform/share'
import { createFileRoute, Link } from '@tanstack/react-router'
import { Button, roundButtonClass } from '@ui/Button'
import { Sheet } from '@ui/Sheet'
import { Message, Skeleton } from '@ui/States'
import { ChevronLeft, FileX, SearchX, WifiOff } from 'lucide-react'
import { lazy, Suspense, useState } from 'react'
import { brand } from '../brand'
import { env } from '../env'

export const Route = createFileRoute('/c/$code')({ component: CaseScreen })

// The forms load when their button is tapped: reading the case must not pay for them.
const SightingForm = lazy(() =>
  import('@features/lost/SightingForm').then((m) => ({ default: m.SightingForm })),
)
const ClaimForm = lazy(() =>
  import('@features/lost/ClaimForm').then((m) => ({ default: m.ClaimForm })),
)
const ownerForms = () => import('@features/lost/OwnerForms')
const ReuniteForm = lazy(() => ownerForms().then((m) => ({ default: m.ReuniteForm })))
const CancelForm = lazy(() => ownerForms().then((m) => ({ default: m.CancelForm })))
const ReopenForm = lazy(() => ownerForms().then((m) => ({ default: m.ReopenForm })))
const ReportForm = lazy(() =>
  import('@features/reporting/ReportForm').then((m) => ({ default: m.ReportForm })),
)

const homeLink = (
  <Link to="/" className="font-bold text-brand-deep">
    Ver otros avisos
  </Link>
)

function CaseScreen() {
  const { code } = Route.useParams()
  const query = useCase(code)
  const [sheet, setSheet] = useState<
    'sighting' | 'claim' | 'report' | 'reunite' | 'cancel' | 'reopen' | 'copied' | null
  >(null)

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

  type Open = 'sighting' | 'claim' | 'report' | 'reunite' | 'cancel' | 'reopen' | 'copied' | null
  const close = () => setSheet(null)

  async function handle(action: LostAction) {
    if (action === 'report_sighting') return setSheet('sighting')
    if (action === 'claim_recovery') return setSheet('claim')
    if (action === 'report_content') return setSheet('report')
    if (action === 'confirm_reunited') return setSheet('reunite')
    if (action === 'cancel') return setSheet('cancel')
    if (action === 'reopen') return setSheet('reopen')
    if (action !== 'share') return
    const result = await shareLink({
      title: `Se busca: ${found.vertical === 'lost' ? found.pet.name : ''}`,
      text: 'Ayúdanos a encontrarla',
      url,
    })
    if (result === 'copied') setSheet('copied')
  }

  const titles: Record<NonNullable<Open>, string> = {
    sighting: `¿Dónde viste a ${found.pet.name}?`,
    claim: `¿Tienes a ${found.pet.name}?`,
    report: '¿Qué pasa con esta publicación?',
    copied: 'Enlace copiado',
    reunite: `¿${found.pet.name} ya apareció?`,
    cancel: 'Eliminar este aviso',
    reopen: 'Reactivar el aviso',
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
        mapStyleUrl={env.mapStyleUrl}
        onAction={handle}
      />
      <Sheet
        open={sheet !== null}
        onClose={close}
        title={sheet ? titles[sheet] : ''}
        size={sheet === 'sighting' ? 'full' : 'auto'}
      >
        <Suspense fallback={<Skeleton className="h-40" />}>
          {sheet === 'sighting' ? (
            <SightingForm
              code={found.code}
              petName={found.pet.name}
              lastSeenPoint={found.lastSeen.center}
              lastSeenAt={found.lastSeen.at}
              area={publicArea({ center: found.lastSeen.center, radiusM: found.lastSeen.radiusM })}
              mapStyleUrl={env.mapStyleUrl}
              onDone={close}
            />
          ) : null}
          {sheet === 'claim' ? (
            <ClaimForm
              code={found.code}
              petName={found.pet.name}
              onDone={close}
              onOnlySaw={() => setSheet('sighting')}
            />
          ) : null}
          {sheet === 'reunite' ? (
            <ReuniteForm
              code={found.code}
              petName={found.pet.name}
              suggested={suggestedAttribution({
                hasConfirmedClaim: found.claims.some((claim) => claim.status === 'confirmed'),
                hasHighlightedSighting: found.sightings.some((s) => s.highlightedByOwner),
              })}
              onDone={close}
            />
          ) : null}
          {sheet === 'cancel' ? <CancelForm code={found.code} onDone={close} /> : null}
          {sheet === 'reopen' ? (
            <ReopenForm code={found.code} petName={found.pet.name} onDone={close} />
          ) : null}
          {sheet === 'report' ? (
            <ReportForm targetType="lost_case" targetCode={found.code} onDone={close} />
          ) : null}
        </Suspense>
        {sheet === 'copied' ? (
          <>
            <p className="m-0 text-muted">Pégalo en WhatsApp o donde quieras compartirlo.</p>
            <Button onClick={close}>Entendido</Button>
          </>
        ) : null}
      </Sheet>
    </>
  )
}
