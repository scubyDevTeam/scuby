import type { AdoptionCase } from '@contracts/adoption'
import {
  type AdoptionAction,
  availableActions,
  pageMode,
  reservedNotice,
} from '@domain/adoption/actions'
import { publicArea } from '@domain/shared/geo'
import { CaseShell } from '@features/case/CaseShell'
import { describePet } from '@features/lost/copy'
import { useI18n } from '@i18n/react'
import { Badge } from '@ui/Badge'
import { Button } from '@ui/Button'
import { CaseMap } from '@ui/Map/CaseMap'
import { Notice } from '@ui/Notice'
import {
  Archive,
  BadgeCheck,
  Clock,
  Flag,
  HeartPulse,
  PartyPopper,
  Share2,
  User,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { bandFor, feeCoversLine, feeLine } from './copy'

type Props = {
  listing: AdoptionCase
  now: Date
  shortUrl: string
  backLink: ReactNode
  mapStyleUrl: string | undefined
  onAction: (action: AdoptionAction) => void
  /** The lister's tools — interests, the check-in — loaded only for the lister. */
  listerPanel: ReactNode
}

function Chips({ labels }: { labels: string[] }) {
  return (
    <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
      {labels.map((label) => (
        <li key={label} className="rounded-full bg-soft px-3 py-1 font-semibold">
          {label}
        </li>
      ))}
    </ul>
  )
}

/**
 * An adoption listing (docs/product/06): a post with reach and continuity. Health flags render
 * prominently — never buried; the fee is always disclosed; contact only ever through an interest.
 */
export function AdoptionCasePage({
  listing,
  now,
  shortUrl,
  backLink,
  mapStyleUrl,
  onAction,
  listerPanel,
}: Props) {
  const i18n = useI18n()
  const { t } = i18n
  const { pet } = listing
  const state = { status: listing.status, resolvedAt: listing.resolvedAt }
  const mode = pageMode(state)
  const mine = listing.myInterest
  const actions = availableActions(state, listing.viewer, mine, now)
  const can = (action: AdoptionAction) => actions.includes(action)
  const name = pet.name
  // The lister sees the circle they drew; everyone else sees it floored at 200 m (04 · precision).
  const area =
    listing.viewer === 'lister'
      ? { center: listing.location.center, radiusM: listing.location.radiusM }
      : publicArea({ center: listing.location.center, radiusM: listing.location.radiusM })
  const notice = mode === 'open' ? reservedNotice(listing.reserved, mine) : null
  const covers = feeCoversLine(i18n, listing.fee)
  const interested = mine !== null && mine.status !== 'withdrawn' && mode === 'open'

  return (
    <CaseShell
      band={bandFor(i18n, listing)}
      shortUrl={shortUrl}
      photoUrls={pet.photoUrls}
      photoAlt={t('adoption.page.photo_alt', { name })}
      backLink={backLink}
      onShare={can('share') ? () => onAction('share') : undefined}
      aside={
        <>
          {listing.temperament.length > 0 || pet.marks ? (
            <section className="flex flex-col gap-2">
              <h2 className="m-0 text-2xl font-extrabold">{t('adoption.page.about_title')}</h2>
              {listing.temperament.length > 0 ? (
                <Chips labels={listing.temperament.map((v) => t(`adoption.temperament.${v}`))} />
              ) : null}
              {pet.marks ? <p className="m-0 text-lg">{pet.marks}</p> : null}
            </section>
          ) : null}

          {listing.requirementFlags.length > 0 || listing.requirements ? (
            <section className="flex flex-col gap-2">
              <h2 className="m-0 text-2xl font-extrabold">{t('adoption.page.home_title')}</h2>
              {listing.requirementFlags.length > 0 ? (
                <Chips
                  labels={listing.requirementFlags.map((v) => t(`adoption.requirement.${v}`))}
                />
              ) : null}
              {listing.requirements ? <p className="m-0">{listing.requirements}</p> : null}
            </section>
          ) : null}

          <section className="flex flex-col gap-1 rounded-2xl bg-brand-mist p-4">
            <p className="m-0 flex items-center gap-2 font-bold">
              {listing.trustTier === 'verified' ? (
                <BadgeCheck aria-hidden="true" className="size-5 shrink-0" />
              ) : (
                <User aria-hidden="true" className="size-5 shrink-0" />
              )}
              {t('adoption.page.lister', { name: listing.listerName })}
            </p>
            <p className="m-0 text-muted">
              {t(
                listing.trustTier === 'verified'
                  ? 'adoption.page.tier_verified'
                  : 'adoption.page.tier_individual',
              )}
            </p>
          </section>

          {can('share') || can('report_content') ? (
            <footer className="flex flex-wrap items-center justify-between gap-2">
              {can('share') ? (
                <Button variant="link" onClick={() => onAction('share')}>
                  <Share2 aria-hidden="true" />
                  {t('adoption.page.share')}
                </Button>
              ) : null}
              {can('report_content') ? (
                <Button
                  variant="link"
                  className="font-normal text-muted"
                  onClick={() => onAction('report_content')}
                >
                  <Flag aria-hidden="true" className="size-4" />
                  {t('adoption.page.report')}
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
          {t('adoption.page.line', {
            place: listing.location.placeName,
            ago: i18n.relative(listing.publishedAt, now),
          })}
        </p>
      </section>

      {/* Surface the flags, never bury them: special-needs adopters self-select (06 · `pet`). */}
      {pet.healthFlags.length > 0 ? (
        <section
          aria-label={t('adoption.page.health_title')}
          className="flex flex-col gap-2 rounded-2xl border-2 border-adoption p-4"
        >
          <h2 className="m-0 flex items-center gap-2 text-xl font-extrabold">
            <HeartPulse aria-hidden="true" className="size-6 shrink-0" />
            {t('adoption.page.health_title')}
          </h2>
          <div className="flex flex-wrap gap-2">
            {pet.healthFlags.map((flag) => (
              <Badge key={flag} tone="adoption">
                {t(`adoption.health.${flag}`)}
              </Badge>
            ))}
          </div>
          <p className="m-0 text-muted">{t('adoption.page.health_hint')}</p>
        </section>
      ) : null}

      <section className="flex flex-col gap-1">
        <p className="m-0 text-xl font-bold">{feeLine(i18n, listing.fee)}</p>
        {covers ? <p className="m-0">{covers}</p> : null}
        <p className="m-0 text-sm text-muted">{t('adoption.page.fee_money')}</p>
      </section>

      {mode === 'closed' ? (
        listing.status === 'adopted' ? (
          <Notice
            tone="success"
            icon={<PartyPopper aria-hidden="true" />}
            title={t('adoption.page.adopted_title', { name })}
          >
            {t('adoption.page.adopted_body')}
          </Notice>
        ) : (
          <Notice tone="neutral" title={t('adoption.page.withdrawn_title', { name })} />
        )
      ) : null}
      {mode === 'archived' ? (
        <Notice
          tone="neutral"
          icon={<Archive aria-hidden="true" />}
          title={t('adoption.page.archived_title')}
        >
          {can('reopen')
            ? t('adoption.page.archived_can_reopen')
            : t('adoption.page.archived_lister_can_reopen')}
        </Notice>
      ) : null}

      {notice === 'chosen_you' ? (
        <Notice tone="success" title={t('adoption.page.chosen_you_title')}>
          {t('adoption.page.chosen_you_body')}
        </Notice>
      ) : null}
      {notice === 'backup_invited' && listing.viewer === 'public' ? (
        <Notice icon={<Clock aria-hidden="true" />}>{t('adoption.page.backup', { name })}</Notice>
      ) : null}

      {interested && notice !== 'chosen_you' ? (
        <Notice tone="neutral" title={t('adoption.page.interested_title')}>
          {t('adoption.page.interested_body')}
        </Notice>
      ) : null}

      {can('express_interest') ? (
        <Button
          hint={t('adoption.page.interest_hint')}
          onClick={() => onAction('express_interest')}
        >
          {t('adoption.page.interest')}
        </Button>
      ) : null}
      {can('open_conversation') ? (
        <Button onClick={() => onAction('open_conversation')}>
          {t('adoption.page.open_conversation')}
        </Button>
      ) : null}
      {can('withdraw_interest') ? (
        <Button
          variant="link"
          className="self-center"
          onClick={() => onAction('withdraw_interest')}
        >
          {t('adoption.page.withdraw_interest')}
        </Button>
      ) : null}
      {can('reopen') ? (
        <Button onClick={() => onAction('reopen')}>{t('adoption.page.reopen')}</Button>
      ) : null}

      {listerPanel}

      <section className="flex flex-col gap-2">
        <h2 className="m-0 text-2xl font-extrabold">{t('adoption.page.story_title')}</h2>
        <p className="m-0 text-lg whitespace-pre-line">{listing.story}</p>
      </section>

      {mode === 'open' ? (
        <section className="flex flex-col gap-3">
          <h2 className="m-0 text-2xl font-extrabold">{t('adoption.page.where_title')}</h2>
          <CaseMap
            styleUrl={mapStyleUrl}
            area={area}
            areaLabel={t('adoption.page.area_label')}
            pins={[]}
          />
        </section>
      ) : null}
    </CaseShell>
  )
}
