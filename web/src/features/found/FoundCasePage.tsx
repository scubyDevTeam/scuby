import type { FoundCase } from '@contracts/found'
import {
  availableActions,
  type FoundAction,
  hasPossibleOwner,
  pageMode,
} from '@domain/found/actions'
import { publicArea } from '@domain/shared/geo'
import { CaseShell } from '@features/case/CaseShell'
import { useI18n } from '@i18n/react'
import { WhatsAppIcon } from '@ui/BrandIcons'
import { Button, buttonClass } from '@ui/Button'
import { CaseMap } from '@ui/Map/CaseMap'
import { Notice } from '@ui/Notice'
import { Archive, Clock, Flag, Home, Share2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { closedBand, describeFound, holdingLabel } from './copy'

type Props = {
  foundCase: FoundCase
  now: Date
  shortUrl: string
  backLink: ReactNode
  mapStyleUrl: string | undefined
  onAction: (action: FoundAction) => void
  /** The custodian's tools: claims to answer and the hold-clock offer. */
  custodianPanel: ReactNode
  /** On `converted`: the link to the adoption listing the animal moved to. */
  successorLink?: ReactNode
}

export function FoundCasePage({
  foundCase,
  now,
  shortUrl,
  backLink,
  mapStyleUrl,
  onAction,
  custodianPanel,
  successorLink,
}: Props) {
  const i18n = useI18n()
  const { t } = i18n
  const { pet, found } = foundCase
  const state = { status: foundCase.status, resolvedAt: foundCase.resolvedAt }
  const mode = pageMode(state)
  const actions = availableActions(state, foundCase.viewer, now)
  const can = (action: FoundAction) => actions.includes(action)
  const title = describeFound(i18n, pet)
  // The floor matters more here than in lost: the custodian's home is where the animal is now.
  const area = publicArea({ center: found.center, radiusM: found.radiusM })
  const band =
    foundCase.status === 'active'
      ? { label: t('found.band.active'), className: 'bg-found' }
      : foundCase.status === 'expired'
        ? { label: t('found.band.expired'), className: 'bg-muted' }
        : {
            label: t(closedBand[foundCase.status]),
            className: foundCase.status === 'cancelled' ? 'bg-muted' : 'bg-found',
          }

  return (
    <CaseShell
      band={band}
      shortUrl={shortUrl}
      photoUrls={pet.photoUrls}
      photoAlt={t('found.page.photo_alt', { title: title.toLowerCase() })}
      backLink={backLink}
      onShare={can('share') ? () => onAction('share') : undefined}
      aside={
        <>
          {pet.marks ? (
            <section>
              <h2 className="m-0 text-2xl font-extrabold">{t('found.page.marks_title')}</h2>
              <p className="m-0 mt-2 text-lg">{pet.marks}</p>
            </section>
          ) : null}

          {can('contact_custodian') && foundCase.contact ? (
            <section className="flex flex-col gap-3 rounded-2xl bg-brand-mist p-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="m-0 font-bold">{foundCase.contact.displayName}</p>
                <p className="m-0 text-muted">{t('found.page.custodian_role')}</p>
              </div>
              {foundCase.contact.whatsappUrl ? (
                <a
                  href={foundCase.contact.whatsappUrl}
                  target="_blank"
                  rel="noreferrer"
                  className={buttonClass('whatsapp', 'lg:w-auto')}
                >
                  <WhatsAppIcon />
                  {t('contact.write_on_whatsapp')}
                </a>
              ) : null}
            </section>
          ) : null}

          {can('share') || can('report_content') ? (
            <footer className="flex flex-wrap items-center justify-between gap-2">
              {can('share') ? (
                <Button variant="link" onClick={() => onAction('share')}>
                  <Share2 aria-hidden="true" />
                  {t('found.page.share')}
                </Button>
              ) : null}
              {can('report_content') ? (
                <Button
                  variant="link"
                  className="font-normal text-muted"
                  onClick={() => onAction('report_content')}
                >
                  <Flag aria-hidden="true" className="size-4" />
                  {t('found.page.report')}
                </Button>
              ) : null}
            </footer>
          ) : null}
        </>
      }
    >
      <section>
        <h1 className="m-0 text-4xl font-extrabold lg:text-5xl">{title}</h1>
        <p className="m-0 mt-1 text-muted">
          {t('found.page.found_line', {
            place: found.placeName,
            date: i18n.date(found.at, { day: 'numeric', month: 'long' }),
            ago: i18n.relative(found.at, now),
          })}
        </p>
        {mode === 'open' ? (
          <p className="m-0 mt-2 flex items-center gap-2">
            <Home aria-hidden="true" className="size-5 shrink-0" />
            {t(holdingLabel[foundCase.holdingWhere])}
          </p>
        ) : null}
      </section>

      {mode === 'closed' && foundCase.status !== 'cancelled' ? (
        <Notice
          tone="success"
          title={t('found.page.closed_title', {
            band: t(closedBand[foundCase.status as 'reunited']),
          })}
        >
          {t('found.page.closed_body')}
        </Notice>
      ) : null}
      {foundCase.status === 'converted' ? successorLink : null}
      {foundCase.status === 'cancelled' ? (
        <Notice tone="neutral" title={t('found.page.cancelled_title')}>
          {t('found.page.cancelled_body')}
        </Notice>
      ) : null}
      {mode === 'archived' ? (
        <Notice
          tone="neutral"
          icon={<Archive aria-hidden="true" />}
          title={t('found.page.archived_title')}
        >
          {can('reopen')
            ? t('found.page.archived_can_reopen')
            : t('found.page.archived_owner_can_reopen')}
        </Notice>
      ) : null}

      {can('claim_ownership') ? (
        <Button hint={t('found.page.claim_hint')} onClick={() => onAction('claim_ownership')}>
          {t('found.page.claim')}
        </Button>
      ) : null}
      {can('reopen') ? (
        <Button onClick={() => onAction('reopen')}>{t('found.page.reopen')}</Button>
      ) : null}

      {can('confirm_reunited') ? (
        <section className="flex flex-col gap-3">
          <Button onClick={() => onAction('confirm_reunited')}>
            {t('found.actions.reunited')}
          </Button>
          <div className="flex flex-col gap-3 lg:flex-row">
            <Button variant="outline" onClick={() => onAction('keep')}>
              {t('found.actions.keep')}
            </Button>
            <Button variant="outline" onClick={() => onAction('transfer_to_org')}>
              {t('found.actions.transfer')}
            </Button>
          </div>
          <Button variant="link" className="text-lost-deep" onClick={() => onAction('cancel')}>
            {t('found.actions.delete')}
          </Button>
        </section>
      ) : null}

      {custodianPanel}

      {mode === 'open' &&
      foundCase.viewer === 'public' &&
      hasPossibleOwner(foundCase.openClaimCount) ? (
        <Notice icon={<Clock aria-hidden="true" />} title={t('found.page.possible_owner_title')}>
          {t('found.page.possible_owner_body')}
        </Notice>
      ) : null}

      {mode === 'open' ? (
        <section className="flex flex-col gap-3">
          <h2 className="m-0 text-2xl font-extrabold">{t('found.page.where_title')}</h2>
          <CaseMap
            styleUrl={mapStyleUrl}
            area={area}
            areaLabel={t('found.page.area_label')}
            pins={[]}
          />
        </section>
      ) : null}
    </CaseShell>
  )
}
