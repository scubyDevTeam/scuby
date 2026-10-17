import type { HelpCase, HelpNeed, MyPledge } from '@contracts/help-case'
import { availableActions, type HelpAction, pageMode } from '@domain/help/actions'
import { publicArea } from '@domain/shared/geo'
import { CaseShell } from '@features/case/CaseShell'
import { describePet } from '@features/lost/copy'
import { useI18n } from '@i18n/react'
import { WhatsAppIcon } from '@ui/BrandIcons'
import { Button, buttonClass } from '@ui/Button'
import { CaseMap } from '@ui/Map/CaseMap'
import { Notice } from '@ui/Notice'
import { Archive, BadgeCheck, Flag, PartyPopper, Share2, ShieldAlert, User } from 'lucide-react'
import type { ReactNode } from 'react'
import { bandFor } from './copy'
import { NeedList } from './NeedList'

type Props = {
  request: HelpCase
  now: Date
  shortUrl: string
  backLink: ReactNode
  mapStyleUrl: string | undefined
  onAction: (action: HelpAction) => void
  /** «Yo ayudo» on one need. */
  onOffer: (need: HelpNeed) => void
  /** «Ya no puedo» on one of the viewer's own pledges. */
  onWithdrawPledge: (pledge: MyPledge) => void
  /** The beneficiary's tools — pledges to confirm, the check-in — loaded only for them. */
  beneficiaryPanel: ReactNode
}

/**
 * A help request (docs/product/07): a pet, one to three things asked in kind, and how far each
 * got — confirmed first, promised second. No amount, goal or payment link exists to show.
 */
export function HelpCasePage({
  request,
  now,
  shortUrl,
  backLink,
  mapStyleUrl,
  onAction,
  onOffer,
  onWithdrawPledge,
  beneficiaryPanel,
}: Props) {
  const i18n = useI18n()
  const { t } = i18n
  const { pet } = request
  const state = { status: request.status, resolvedAt: request.resolvedAt }
  const mode = pageMode(state)
  const actions = availableActions(state, request.viewer, now)
  const can = (action: HelpAction) => actions.includes(action)
  const name = pet.name
  const beneficiary = request.beneficiaryName
  // The beneficiary sees the circle they drew; everyone else sees it floored at 200 m (04).
  const area =
    request.viewer === 'beneficiary'
      ? { center: request.location.center, radiusM: request.location.radiusM }
      : publicArea({ center: request.location.center, radiusM: request.location.radiusM })

  const minePledges = (pledges: MyPledge[]) =>
    pledges
      .filter((pledge) => pledge.status !== 'withdrawn')
      .map((pledge) => (
        <div key={pledge.id} className="flex flex-col gap-2 rounded-xl bg-soft p-3">
          <p className="m-0 font-semibold">
            {t(`help.mine.${pledge.status === 'pledged' ? 'waiting' : pledge.status}`, {
              name: beneficiary,
            })}
          </p>
          {pledge.status === 'pledged' && mode === 'open' ? (
            <div className="flex flex-wrap gap-2">
              {pledge.whatsappUrl ? (
                <a
                  href={pledge.whatsappUrl}
                  target="_blank"
                  rel="noreferrer"
                  className={buttonClass('whatsapp', 'w-auto')}
                >
                  <WhatsAppIcon />
                  {t('help.mine.write')}
                </a>
              ) : null}
              <Button variant="link" onClick={() => onWithdrawPledge(pledge)}>
                {t('help.mine.withdraw')}
              </Button>
            </div>
          ) : null}
        </div>
      ))

  return (
    <CaseShell
      band={bandFor(i18n, request)}
      shortUrl={shortUrl}
      photoUrls={pet.photoUrls}
      photoAlt={t('help.page.photo_alt', { name })}
      backLink={backLink}
      onShare={can('share') ? () => onAction('share') : undefined}
      aside={
        <>
          <section className="flex flex-col gap-1 rounded-2xl bg-brand-mist p-4">
            <p className="m-0 flex items-center gap-2 font-bold">
              {request.trustTier === 'verified' ? (
                <BadgeCheck aria-hidden="true" className="size-5 shrink-0" />
              ) : (
                <User aria-hidden="true" className="size-5 shrink-0" />
              )}
              {t('help.page.beneficiary', { name: beneficiary })}
            </p>
            <p className="m-0 text-muted">
              {t(
                request.trustTier === 'verified'
                  ? 'help.page.tier_verified'
                  : 'help.page.tier_unverified',
              )}
            </p>
          </section>

          {mode === 'open' ? (
            <Notice tone="warning" icon={<ShieldAlert aria-hidden="true" />}>
              {t('help.page.safety')}
            </Notice>
          ) : null}

          {can('share') || can('report_content') ? (
            <footer className="flex flex-wrap items-center justify-between gap-2">
              {can('share') ? (
                <Button variant="link" onClick={() => onAction('share')}>
                  <Share2 aria-hidden="true" />
                  {t('help.page.share')}
                </Button>
              ) : null}
              {can('report_content') ? (
                <Button
                  variant="link"
                  className="font-normal text-muted"
                  onClick={() => onAction('report_content')}
                >
                  <Flag aria-hidden="true" className="size-4" />
                  {t('help.page.report')}
                </Button>
              ) : null}
            </footer>
          ) : null}
        </>
      }
    >
      <section>
        <h1 className="m-0 text-4xl font-extrabold lg:text-5xl">{name}</h1>
        <p className="m-0 mt-1 text-lg font-semibold">{describePet(i18n, pet)}</p>
        <p className="m-0 mt-1 text-muted">
          {t('help.page.line', {
            place: request.location.placeName,
            ago: i18n.relative(request.publishedAt, now),
          })}
        </p>
      </section>

      {mode === 'closed' ? (
        request.resolution === 'covered' ? (
          <Notice
            tone="success"
            icon={<PartyPopper aria-hidden="true" />}
            title={t('help.page.closed_title', { name })}
          >
            {t('help.page.closed_body')}
          </Notice>
        ) : (
          <Notice
            tone="neutral"
            title={t(
              request.status === 'removed' ? 'help.page.removed_title' : 'help.page.ended_title',
            )}
          />
        )
      ) : null}
      {mode === 'archived' ? (
        <Notice
          tone="neutral"
          icon={<Archive aria-hidden="true" />}
          title={t('help.page.archived_title')}
        >
          {can('reopen')
            ? t('help.page.archived_can_reopen')
            : t('help.page.archived_beneficiary_can_reopen')}
        </Notice>
      ) : null}
      {can('edit') ? (
        <Button variant="outline" onClick={() => onAction('edit')}>
          {t('help.page.edit')}
        </Button>
      ) : null}
      {can('reopen') ? (
        <Button onClick={() => onAction('reopen')}>{t('help.page.reopen')}</Button>
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="m-0 text-2xl font-extrabold">{t('help.page.needs_title')}</h2>
        <NeedList request={request} onOffer={can('pledge') ? onOffer : null} mine={minePledges} />
        {mode === 'open' && request.viewer === 'public' ? (
          <p className="m-0 text-sm text-muted">{t('help.page.no_money')}</p>
        ) : null}
      </section>

      {beneficiaryPanel}

      {can('close_request') ? (
        <Button
          variant="link"
          className="self-start text-muted"
          onClick={() => onAction('close_request')}
        >
          {t('help.page.close')}
        </Button>
      ) : null}

      <section className="flex flex-col gap-2">
        <h2 className="m-0 text-2xl font-extrabold">{t('help.page.story_title')}</h2>
        <p className="m-0 text-lg whitespace-pre-line">{request.story}</p>
      </section>

      {mode === 'open' ? (
        <section className="flex flex-col gap-3">
          <h2 className="m-0 text-2xl font-extrabold">{t('help.page.where_title')}</h2>
          <CaseMap
            styleUrl={mapStyleUrl}
            area={area}
            areaLabel={t('help.page.area_label')}
            pins={[]}
          />
        </section>
      ) : null}
    </CaseShell>
  )
}
