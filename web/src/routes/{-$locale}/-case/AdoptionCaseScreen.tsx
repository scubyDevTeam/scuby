import { useWithdrawInterest } from '@api-client/adoption'
import { useReopenCase } from '@api-client/owner'
import { useSession } from '@api-client/session'
import type { AdoptionCase } from '@contracts/adoption'
import type { AdoptionAction } from '@domain/adoption/actions'
import { AdoptionCasePage } from '@features/adoption/AdoptionCasePage'
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
import { LegalLine } from '../../-legal'

// «Me interesa» and the lister's tools load when they are needed, with their words: a stranger
// opening the link pays for the listing only.
const interestForms = withMessages(
  ['adoption_forms', 'publish'],
  () => import('@features/adoption/InterestForm'),
)
const InterestForm = lazy(() => interestForms().then((m) => ({ default: m.InterestForm })))
const Conversation = lazy(() => interestForms().then((m) => ({ default: m.Conversation })))
const ListerPanel = lazy(
  withMessages(['adoption_forms'], () =>
    import('@features/adoption/ListerPanel').then((m) => ({ default: m.ListerPanel })),
  ),
)
const listerForms = withMessages(['adoption_forms'], () => import('@features/adoption/ListerForms'))
const RecordAdoptionForm = lazy(() =>
  listerForms().then((m) => ({ default: m.RecordAdoptionForm })),
)
const WithdrawListingForm = lazy(() =>
  listerForms().then((m) => ({ default: m.WithdrawListingForm })),
)
const ReportForm = lazy(
  withMessages(['reporting'], () =>
    import('@features/reporting/ReportForm').then((m) => ({ default: m.ReportForm })),
  ),
)
const PosterSheet = lazy(
  withMessages(['sharing'], () =>
    import('@features/poster/PosterSheet').then((m) => ({ default: m.PosterSheet })),
  ),
)
const SignIn = lazy(
  withMessages(['auth'], () =>
    import('@features/auth/SignIn').then((m) => ({ default: m.SignIn })),
  ),
)

/** The code the emulated backend accepts (src/mocks/handlers.ts). */
const DEMO_CODE = '123456'

const EditCase = lazy(
  withMessages(['edit_case', 'adoption', 'publish'], () =>
    import('@features/edit/EditCase').then((m) => ({ default: m.EditCase })),
  ),
)

type Open = 'edit' | 'interest' | 'conversation' | 'record' | 'withdraw' | 'report' | 'share' | null

export function AdoptionCaseScreen({ found }: { found: AdoptionCase }) {
  const { t } = useI18n()
  const [sheet, setSheet] = useState<Open>(null)
  const session = useSession()
  const withdrawInterest = useWithdrawInterest(found.code)
  const reopen = useReopenCase(found.code)
  const close = () => setSheet(null)
  const name = found.pet.name
  // The short link carries no language: posters and shared links reach everyone the same way.
  const url = `${brand.origin}/c/${found.code}`
  const shortUrl = `${new URL(brand.origin).host}/c/${found.code}`
  const demoCode = env.apiMock ? DEMO_CODE : undefined

  function handle(action: AdoptionAction) {
    if (action === 'edit') return setSheet('edit')
    if (action === 'express_interest') return setSheet('interest')
    if (action === 'open_conversation') return setSheet('conversation')
    if (action === 'record_adoption') return setSheet('record')
    if (action === 'withdraw_listing') return setSheet('withdraw')
    if (action === 'report_content') return setSheet('report')
    if (action === 'share') return setSheet('share')
    // One tap each: «ya no me interesa» keeps the lister's list honest; reopening is one tap (08).
    if (action === 'withdraw_interest' && found.myInterest) {
      return withdrawInterest.mutate(found.myInterest.id)
    }
    if (action === 'reopen') return reopen.mutate()
  }

  const titles: Record<NonNullable<Open>, string> = {
    edit: t('edit_case.title', { name }),
    interest: t('adoption.sheet.interest_title', { name }),
    conversation: t('adoption.sheet.conversation_title', { name: found.listerName }),
    record: t('adoption.sheet.record_title', { name }),
    withdraw: t('adoption.sheet.withdraw_title'),
    report: t('case.report_title'),
    share: t('case.share_title_named', { name }),
  }

  return (
    <>
      <AdoptionCasePage
        listing={found}
        now={new Date()}
        shortUrl={shortUrl}
        backLink={
          <Link to="/{-$locale}" aria-label={t('common.back_home')} className={roundButtonClass}>
            <ChevronLeft aria-hidden="true" />
          </Link>
        }
        mapStyleUrl={env.mapStyleUrl}
        onAction={handle}
        listerPanel={
          found.viewer === 'lister' && found.status === 'active' ? (
            <Suspense fallback={<Skeleton className="h-40" />}>
              <ListerPanel
                listing={found}
                now={new Date()}
                onRecord={() => setSheet('record')}
                onWithdraw={() => setSheet('withdraw')}
              />
            </Suspense>
          ) : null
        }
      />
      <Sheet
        open={sheet !== null}
        onClose={close}
        title={sheet ? titles[sheet] : ''}
        size={sheet === 'share' || sheet === 'interest' ? 'full' : 'auto'}
      >
        <Suspense fallback={<Skeleton className="h-40" />}>
          {sheet === 'interest' ? (
            // Adopting is a commitment, not a tip: «Me interesa» always has an account behind it.
            session.data ? (
              <InterestForm
                code={found.code}
                petName={name}
                listerName={found.listerName}
                link={url}
                user={session.data}
                demoCode={demoCode}
                onDone={close}
              />
            ) : (
              <SignIn
                googleClientId={env.googleClientId}
                demoCode={demoCode}
                legal={<LegalLine />}
              />
            )
          ) : null}
          {sheet === 'conversation' && found.myInterest ? (
            <Conversation
              listerName={found.listerName}
              channels={found.myInterest}
              text={null}
              onDone={close}
            />
          ) : null}
          {sheet === 'record' ? <RecordAdoptionForm listing={found} onDone={close} /> : null}
          {sheet === 'withdraw' ? <WithdrawListingForm code={found.code} onDone={close} /> : null}
          {sheet === 'edit' ? (
            <EditCase
              editable={{
                code: found.code,
                photoUrls: found.pet.photoUrls,
                story: found.story,
                temperament: found.temperament,
                requirements: found.requirements,
              }}
              onDone={close}
            />
          ) : null}
          {sheet === 'report' ? (
            <ReportForm targetType="adoption_case" targetCode={found.code} onDone={close} />
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
