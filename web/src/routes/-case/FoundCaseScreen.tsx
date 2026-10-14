import { useSession } from '@api-client/session'
import type { FoundCase } from '@contracts/found'
import type { FoundAction } from '@domain/found/actions'
import { CustodianPanel } from '@features/found/CustodianPanel'
import { describeFound } from '@features/found/copy'
import { FoundCasePage } from '@features/found/FoundCasePage'
import { shareLink } from '@platform/share'
import { Link } from '@tanstack/react-router'
import { Button, roundButtonClass } from '@ui/Button'
import { Sheet } from '@ui/Sheet'
import { Skeleton } from '@ui/States'
import { ChevronLeft } from 'lucide-react'
import { lazy, Suspense, useState } from 'react'
import { brand } from '../../brand'
import { env } from '../../env'

// Loaded when their button is tapped: reading the case must not pay for them.
const OwnershipClaimForm = lazy(() =>
  import('@features/found/OwnershipClaimForm').then((m) => ({ default: m.OwnershipClaimForm })),
)
const ResolveForm = lazy(() =>
  import('@features/found/CustodianForms').then((m) => ({ default: m.ResolveForm })),
)
const ReopenForm = lazy(() =>
  import('@features/lost/OwnerForms').then((m) => ({ default: m.ReopenForm })),
)
const ReportForm = lazy(() =>
  import('@features/reporting/ReportForm').then((m) => ({ default: m.ReportForm })),
)
const SignIn = lazy(() => import('@features/auth/SignIn').then((m) => ({ default: m.SignIn })))

/** The code the emulated backend accepts (src/mocks/handlers.ts). */
const DEMO_CODE = '123456'

type Open =
  | 'mine'
  | 'report'
  | 'reunited'
  | 'kept'
  | 'transferred_to_org'
  | 'cancelled'
  | 'reopen'
  | 'copied'
  | null

const sheetFor: Partial<Record<FoundAction, NonNullable<Open>>> = {
  claim_ownership: 'mine',
  report_content: 'report',
  confirm_reunited: 'reunited',
  keep: 'kept',
  transfer_to_org: 'transferred_to_org',
  cancel: 'cancelled',
  reopen: 'reopen',
}

const titles: Record<NonNullable<Open>, string> = {
  mine: '¿Es tu mascota?',
  report: '¿Qué pasa con esta publicación?',
  reunited: '¿Ya está con su dueño?',
  kept: '¿Te lo quedas?',
  transferred_to_org: '¿Lo entregaste a una fundación?',
  cancelled: 'Eliminar este aviso',
  reopen: 'Reactivar el aviso',
  copied: 'Enlace copiado',
}

export function FoundCaseScreen({ found }: { found: FoundCase }) {
  const [sheet, setSheet] = useState<Open>(null)
  const session = useSession()
  const title = describeFound(found.pet)
  const close = () => setSheet(null)

  async function handle(action: FoundAction) {
    const next = sheetFor[action]
    if (next) return setSheet(next)
    if (action !== 'share') return
    const result = await shareLink({
      title: `Se encontró: ${title}`,
      text: '¿Lo reconoces? Ayúdanos a encontrar a su familia',
      url: `${brand.origin}/c/${found.code}`,
    })
    if (result === 'copied') setSheet('copied')
  }

  return (
    <>
      <FoundCasePage
        foundCase={found}
        now={new Date()}
        shortUrl={`${new URL(brand.origin).host}/c/${found.code}`}
        backLink={
          <Link to="/" aria-label="Volver al inicio" className={roundButtonClass}>
            <ChevronLeft aria-hidden="true" />
          </Link>
        }
        mapStyleUrl={env.mapStyleUrl}
        onAction={handle}
        custodianPanel={
          <CustodianPanel
            foundCase={found}
            now={new Date()}
            onConfirmed={() => setSheet('reunited')}
            onKeep={() => setSheet('kept')}
            onTransfer={() => setSheet('transferred_to_org')}
          />
        }
      />
      <Sheet open={sheet !== null} onClose={close} title={sheet ? titles[sheet] : ''}>
        <Suspense fallback={<Skeleton className="h-40" />}>
          {sheet === 'mine' ? (
            // «Es mío» is never anonymous: it asks to take an animal. The account is born here.
            session.data ? (
              <OwnershipClaimForm code={found.code} onDone={close} />
            ) : (
              <SignIn
                googleClientId={env.googleClientId}
                demoCode={env.apiMock ? DEMO_CODE : undefined}
                legal="Al continuar aceptas los Términos y la Política de tratamiento de datos."
              />
            )
          ) : null}
          {sheet === 'report' ? (
            <ReportForm targetType="found_case" targetCode={found.code} onDone={close} />
          ) : null}
          {sheet === 'reunited' ||
          sheet === 'kept' ||
          sheet === 'transferred_to_org' ||
          sheet === 'cancelled' ? (
            <ResolveForm
              key={sheet}
              code={found.code}
              outcome={sheet}
              suggested={
                found.ownershipClaims.some((claim) => claim.status === 'confirmed')
                  ? 'platform_claim'
                  : null
              }
              onDone={close}
            />
          ) : null}
          {sheet === 'reopen' ? (
            <ReopenForm code={found.code} petName={title.toLowerCase()} onDone={close} />
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
