import type { LostCase } from '@contracts/case'
import type { LostAction } from '@domain/lost/actions'
import { closeAnswersCheckin } from '@domain/lost/checkin'
import { suggestedAttribution } from '@domain/lost/resolution'
import { publicArea } from '@domain/shared/geo'
import { LostCasePage } from '@features/lost/LostCasePage'
import { withMessages } from '@i18n/locales'
import { useI18n } from '@i18n/react'
import { Link } from '@tanstack/react-router'
import { roundButtonClass } from '@ui/Button'
import { Sheet } from '@ui/Sheet'
import { Skeleton } from '@ui/States'
import { ChevronLeft } from 'lucide-react'
import { lazy, Suspense, useState } from 'react'
import { brand } from '../../../brand'
import { env } from '../../../env'

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
const ReportForm = lazy(
  withMessages(['reporting'], () =>
    import('@features/reporting/ReportForm').then((m) => ({ default: m.ReportForm })),
  ),
)
// The poster, its canvas code and the QR encoder: none of it belongs to a case's first load.
const PosterSheet = lazy(
  withMessages(['sharing'], () =>
    import('@features/poster/PosterSheet').then((m) => ({ default: m.PosterSheet })),
  ),
)

type Open = 'sighting' | 'claim' | 'report' | 'reunite' | 'cancel' | 'reopen' | 'share' | null

export function LostCaseScreen({ found }: { found: LostCase }) {
  const { t } = useI18n()
  const [sheet, setSheet] = useState<Open>(null)
  // The short link carries no language: posters and shared links reach everyone the same way.
  const url = `${brand.origin}/c/${found.code}`
  const shortUrl = `${new URL(brand.origin).host}/c/${found.code}`
  const name = found.pet.name
  const close = () => setSheet(null)
  // Closing or deleting while «¿sigue perdida?» waits is that question's answer.
  const checkinId = closeAnswersCheckin(found.pendingCheckin)
    ? (found.pendingCheckin?.id ?? null)
    : null

  function handle(action: LostAction) {
    if (action === 'report_sighting') return setSheet('sighting')
    if (action === 'claim_recovery') return setSheet('claim')
    if (action === 'report_content') return setSheet('report')
    if (action === 'confirm_reunited') return setSheet('reunite')
    if (action === 'cancel') return setSheet('cancel')
    if (action === 'reopen') return setSheet('reopen')
    if (action === 'share') return setSheet('share')
  }

  const titles: Record<NonNullable<Open>, string> = {
    sighting: t('case.lost.sighting_title', { name }),
    claim: t('case.lost.claim_title', { name }),
    report: t('case.report_title'),
    share: t('case.share_title_named', { name }),
    reunite: t('case.lost.reunite_title', { name }),
    cancel: t('case.cancel_title'),
    reopen: t('case.reopen_title'),
  }

  return (
    <>
      <LostCasePage
        lostCase={found}
        now={new Date()}
        shortUrl={shortUrl}
        backLink={
          <Link to="/{-$locale}" aria-label={t('common.back_home')} className={roundButtonClass}>
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
        size={sheet === 'sighting' || sheet === 'share' ? 'full' : 'auto'}
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
              checkinId={checkinId}
              onDone={close}
            />
          ) : null}
          {sheet === 'cancel' ? (
            <CancelForm code={found.code} checkinId={checkinId} onDone={close} />
          ) : null}
          {sheet === 'reopen' ? (
            <ReopenForm code={found.code} petName={found.pet.name} onDone={close} />
          ) : null}
          {sheet === 'report' ? (
            <ReportForm targetType="lost_case" targetCode={found.code} onDone={close} />
          ) : null}
          {sheet === 'share' ? (
            <PosterSheet
              posterCase={found}
              link={{ url, display: shortUrl }}
              brand={{ name: brand.name, markUrl: brand.markUrl }}
            />
          ) : null}
        </Suspense>
      </Sheet>
    </>
  )
}
