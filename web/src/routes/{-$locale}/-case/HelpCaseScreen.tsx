import { useWithdrawPledge } from '@api-client/help'
import { useReopenCase } from '@api-client/owner'
import { useSession } from '@api-client/session'
import type { HelpCase, HelpNeed } from '@contracts/help-case'
import type { HelpAction } from '@domain/help/actions'
import { HelpCasePage } from '@features/help/HelpCasePage'
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

// «Yo ayudo» and the beneficiary's tools load when they are needed, with their words: a stranger
// opening the link pays for the request only.
const PledgeForm = lazy(
  withMessages(['help_forms', 'publish'], () =>
    import('@features/help/PledgeForm').then((m) => ({ default: m.PledgeForm })),
  ),
)
const BeneficiaryPanel = lazy(
  withMessages(['help_forms'], () =>
    import('@features/help/BeneficiaryPanel').then((m) => ({ default: m.BeneficiaryPanel })),
  ),
)
const CloseHelpForm = lazy(
  withMessages(['help_forms'], () =>
    import('@features/help/CloseHelpForm').then((m) => ({ default: m.CloseHelpForm })),
  ),
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

type Open = 'edit' | 'pledge' | 'close' | 'report' | 'share' | null

export function HelpCaseScreen({ found }: { found: HelpCase }) {
  const { t } = useI18n()
  const [sheet, setSheet] = useState<Open>(null)
  const [need, setNeed] = useState<HelpNeed | null>(null)
  const session = useSession()
  const withdraw = useWithdrawPledge(found.code)
  const reopen = useReopenCase(found.code)
  const close = () => setSheet(null)
  const name = found.pet.name
  // The short link carries no language: posters and shared links reach everyone the same way.
  const url = `${brand.origin}/c/${found.code}`
  const shortUrl = `${new URL(brand.origin).host}/c/${found.code}`
  const demoCode = env.apiMock ? DEMO_CODE : undefined

  function handle(action: HelpAction) {
    if (action === 'edit') return setSheet('edit')
    if (action === 'close_request') return setSheet('close')
    if (action === 'report_content') return setSheet('report')
    if (action === 'share') return setSheet('share')
    if (action === 'reopen') return reopen.mutate()
    // «Yo ayudo» without a need picked: the first one still open.
    if (action === 'pledge') {
      setNeed(found.needs.find((n) => n.status === 'open') ?? null)
      return setSheet('pledge')
    }
  }

  const titles: Record<NonNullable<Open>, string> = {
    edit: t('edit_case.title', { name }),
    pledge: t('help.sheet.pledge_title', { name }),
    close: t('help.sheet.close_title', { name }),
    report: t('case.report_title'),
    share: t('case.share_title_named', { name }),
  }

  return (
    <>
      <HelpCasePage
        request={found}
        now={new Date()}
        shortUrl={shortUrl}
        backLink={
          <Link to="/{-$locale}" aria-label={t('common.back_home')} className={roundButtonClass}>
            <ChevronLeft aria-hidden="true" />
          </Link>
        }
        mapStyleUrl={env.mapStyleUrl}
        onAction={handle}
        onOffer={(picked) => {
          setNeed(picked)
          setSheet('pledge')
        }}
        onWithdrawPledge={(pledge) => withdraw.mutate(pledge.id)}
        beneficiaryPanel={
          found.viewer === 'beneficiary' && found.status === 'active' ? (
            <Suspense fallback={<Skeleton className="h-40" />}>
              <BeneficiaryPanel
                request={found}
                now={new Date()}
                onClose={() => setSheet('close')}
              />
            </Suspense>
          ) : null
        }
      />
      <Sheet
        open={sheet !== null}
        onClose={close}
        title={sheet ? titles[sheet] : ''}
        size={sheet === 'share' || sheet === 'pledge' ? 'full' : 'auto'}
      >
        <Suspense fallback={<Skeleton className="h-40" />}>
          {sheet === 'pledge' && need ? (
            // Offering help needs a reachable person: the account is born here (07 · ladder).
            session.data ? (
              <PledgeForm
                code={found.code}
                need={need}
                beneficiaryName={found.beneficiaryName}
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
          {sheet === 'close' ? <CloseHelpForm code={found.code} onDone={close} /> : null}
          {sheet === 'edit' ? (
            <EditCase
              editable={{
                code: found.code,
                photoUrls: found.pet.photoUrls,
                marks: found.pet.marks,
                story: found.story,
              }}
              onDone={close}
            />
          ) : null}
          {sheet === 'report' ? (
            <ReportForm targetType="help_request" targetCode={found.code} onDone={close} />
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
