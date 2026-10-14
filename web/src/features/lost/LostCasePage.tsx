import type { LostCase } from '@contracts/case'
import { availableActions, hasPossibleFind, type LostAction, pageMode } from '@domain/lost/actions'
import { placeSightings } from '@domain/lost/sightings'
import { publicArea } from '@domain/shared/geo'
import { CaseShell } from '@features/case/CaseShell'
import { useI18n } from '@i18n/react'
import { WhatsAppIcon } from '@ui/BrandIcons'
import { Button, buttonClass } from '@ui/Button'
import { CaseMap } from '@ui/Map/CaseMap'
import { Notice } from '@ui/Notice'
import { Archive, Clock, Flag, PartyPopper, Share2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { ClaimsList } from './ClaimsList'
import { describePet, formatDayMonth, sightingsCount } from './copy'
import { SightingTimeline } from './SightingTimeline'

type Props = {
  lostCase: LostCase
  now: Date
  /** Host and code as printed on the band — the address people type from a poster. */
  shortUrl: string
  backLink: ReactNode
  /** Tile style for the map; undefined draws the area and pins without streets. */
  mapStyleUrl: string | undefined
  onAction: (action: LostAction) => void
}

export function LostCasePage({ lostCase, now, shortUrl, backLink, mapStyleUrl, onAction }: Props) {
  const i18n = useI18n()
  const { t } = i18n
  const { pet, lastSeen } = lostCase
  const state = { status: lostCase.status, resolvedAt: lostCase.resolvedAt }
  const mode = pageMode(state)
  const actions = availableActions(state, lostCase.viewer, now)
  const can = (action: LostAction) => actions.includes(action)
  // The owner sees the circle they drew; everyone else sees it floored at 200 m.
  const area =
    lostCase.viewer === 'owner'
      ? { center: lastSeen.center, radiusM: lastSeen.radiusM }
      : publicArea({ center: lastSeen.center, radiusM: lastSeen.radiusM })
  const sightings = placeSightings(lostCase.sightings, lastSeen.center, now)

  const band =
    mode === 'open'
      ? { label: t('lost.page.band_open'), className: 'bg-lost' }
      : lostCase.status === 'reunited'
        ? { label: t('lost.page.band_reunited'), className: 'bg-found' }
        : {
            label: t(mode === 'archived' ? 'lost.page.band_archived' : 'lost.page.band_closed'),
            className: 'bg-muted',
          }

  return (
    <CaseShell
      band={band}
      shortUrl={shortUrl}
      photoUrls={pet.photoUrls}
      photoAlt={t('lost.page.photo_alt', { name: pet.name })}
      backLink={backLink}
      onShare={can('share') ? () => onAction('share') : undefined}
      aside={
        <>
          {pet.marks ? (
            <section>
              <h2 className="m-0 text-2xl font-extrabold">{t('lost.page.marks_title')}</h2>
              <p className="m-0 mt-2 text-lg">{pet.marks}</p>
            </section>
          ) : null}

          {can('contact_owner') && lostCase.contact ? (
            <section className="flex flex-col gap-3 rounded-2xl bg-brand-mist p-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="m-0 font-bold">{lostCase.contact.displayName}</p>
                <p className="m-0 text-muted">{t('lost.page.contact_family')}</p>
              </div>
              {lostCase.contact.whatsappUrl ? (
                <a
                  href={lostCase.contact.whatsappUrl}
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
                  {t('lost.page.share')}
                </Button>
              ) : null}
              {can('report_content') ? (
                <Button
                  variant="link"
                  className="font-normal text-muted"
                  onClick={() => onAction('report_content')}
                >
                  <Flag aria-hidden="true" className="size-4" />
                  {t('lost.page.report')}
                </Button>
              ) : null}
            </footer>
          ) : null}
        </>
      }
    >
      <section>
        <h1 className="m-0 text-4xl font-extrabold lg:text-6xl">{pet.name}</h1>
        <p className="m-0 mt-1 text-lg lg:text-xl">{describePet(i18n, pet)}</p>
        <p className="m-0 mt-1 text-muted">
          {t('lost.page.lost_at', {
            place: lastSeen.placeName,
            date: formatDayMonth(i18n, lastSeen.at),
            ago: i18n.relative(lastSeen.at, now),
          })}
        </p>
      </section>

      {mode === 'closed' && lostCase.status === 'reunited' ? (
        <Notice
          tone="success"
          icon={<PartyPopper aria-hidden="true" />}
          title={t('lost.page.reunited_title', { name: pet.name })}
        >
          {t('lost.page.reunited_body')}
        </Notice>
      ) : null}
      {mode === 'closed' && lostCase.status === 'cancelled' ? (
        <Notice tone="neutral" title={t('lost.page.cancelled_title')}>
          {t('lost.page.cancelled_body')}
        </Notice>
      ) : null}
      {mode === 'archived' ? (
        <Notice
          tone="neutral"
          icon={<Archive aria-hidden="true" />}
          title={t('lost.page.archived_title')}
        >
          {t(can('reopen') ? 'lost.page.archived_owner' : 'lost.page.archived_public')}
        </Notice>
      ) : null}

      {can('report_sighting') || can('claim_recovery') ? (
        <section className="flex flex-col gap-3 lg:flex-row">
          {can('report_sighting') ? (
            <Button hint={t('lost.page.saw_it_hint')} onClick={() => onAction('report_sighting')}>
              {t('lost.page.saw_it')}
            </Button>
          ) : null}
          {can('claim_recovery') ? (
            <Button variant="outline" onClick={() => onAction('claim_recovery')}>
              {t('lost.page.have_it')}
            </Button>
          ) : null}
        </section>
      ) : null}
      {can('confirm_reunited') ? (
        <section className="flex flex-col gap-3">
          <Button onClick={() => onAction('confirm_reunited')}>
            {t('lost.page.reunited_action')}
          </Button>
          <Button variant="link" className="text-lost-deep" onClick={() => onAction('cancel')}>
            {t('lost.page.delete')}
          </Button>
        </section>
      ) : null}
      {can('reopen') ? (
        <Button onClick={() => onAction('reopen')}>{t('lost.page.reopen')}</Button>
      ) : null}

      {lostCase.viewer === 'owner' && mode === 'open' ? (
        <ClaimsList
          code={lostCase.code}
          petName={pet.name}
          claims={lostCase.claims}
          now={now}
          revealsOwnNumber={lostCase.contact?.whatsappUrl == null}
          onConfirmed={() => onAction('confirm_reunited')}
        />
      ) : null}

      {mode === 'open' &&
      lostCase.viewer === 'public' &&
      hasPossibleFind(lostCase.openClaimCount) ? (
        <Notice icon={<Clock aria-hidden="true" />} title={t('lost.page.possible_find_title')}>
          {t('lost.page.possible_find_body')}
        </Notice>
      ) : null}

      {mode === 'open' ? (
        <section className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between">
            <h2 className="m-0 text-2xl font-extrabold">{t('lost.page.trail_title')}</h2>
            <span className="text-muted">{sightingsCount(i18n, sightings.length)}</span>
          </div>
          <CaseMap
            styleUrl={mapStyleUrl}
            area={area}
            areaLabel={t('lost.page.area_label')}
            pins={sightings.map((s) => ({
              id: s.id,
              point: s.point,
              order: s.order,
              band: s.band,
              emphasized: s.emphasized,
              label: s.isLatest ? i18n.relative(s.seenAt, now) : undefined,
            }))}
          />
          {sightings.length > 0 ? (
            <SightingTimeline sightings={sightings} now={now} />
          ) : (
            <p className="m-0 text-muted">{t('lost.page.no_sightings')}</p>
          )}
        </section>
      ) : null}
    </CaseShell>
  )
}
