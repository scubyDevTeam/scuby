import { useAnswerInterest, useStillAvailable } from '@api-client/adoption'
import type { AdoptionCase, AdoptionInterest } from '@contracts/adoption'
import { interestMoves, isReserved, MOVE_STATUS } from '@domain/adoption/machine'
import { useI18n } from '@i18n/react'
import { Badge } from '@ui/Badge'
import { WhatsAppIcon } from '@ui/BrandIcons'
import { Button, buttonClass } from '@ui/Button'
import { Notice } from '@ui/Notice'
import { memberSince } from './copy'

type Props = {
  listing: AdoptionCase
  now: Date
  /** «Ya fue adoptado» → «¿Quién lo adoptó?» */
  onRecord: () => void
  /** «Ya no está disponible» → the reason. */
  onWithdraw: () => void
}

/**
 * What only the lister sees (06 · What the lister sees): not an inbox — a list. Each person with
 * the four intro fields as chips, when they asked, the conversation link, and facts from the
 * account next to the name, never a verdict. No ranking, no scoring: oldest first.
 */
export function ListerPanel({ listing, now, onRecord, onWithdraw }: Props) {
  const { t } = useI18n()
  const stillAvailable = useStillAvailable(listing.code)
  if (listing.viewer !== 'lister' || listing.status !== 'active') return null

  const name = listing.pet.name
  const checkin = listing.pendingCheckin
  const waiting = listing.interests.filter((i) => i.status === 'open').length
  const endings = (
    <div className="flex flex-col gap-3 lg:flex-row">
      <Button variant="outline" onClick={onRecord}>
        {t('adoption_forms.lister.record')}
      </Button>
      <Button variant="outline" onClick={onWithdraw}>
        {t('adoption_forms.lister.withdraw')}
      </Button>
    </div>
  )

  return (
    <>
      {checkin ? (
        <section
          aria-label={t('adoption_forms.checkin.label')}
          className="flex flex-col gap-3 rounded-2xl bg-brand-mist p-4"
        >
          <p className="m-0 font-bold">{t('adoption_forms.checkin.title', { name })}</p>
          {/* «Three humans are hanging» moves a lister; with nobody waiting, better photos help. */}
          <p className="m-0">
            {waiting > 0
              ? t('adoption_forms.checkin.waiting', { count: waiting, name })
              : t('adoption_forms.checkin.no_interest')}
          </p>
          <p className="m-0 text-muted">{t('adoption_forms.checkin.body')}</p>
          <Button
            disabled={stillAvailable.isPending}
            onClick={() => stillAvailable.mutate(checkin.id)}
          >
            {t('adoption_forms.checkin.still_available')}
          </Button>
          {endings}
          {stillAvailable.isError ? (
            <Notice tone="warning">{t('adoption_forms.checkin.failed')}</Notice>
          ) : null}
        </section>
      ) : (
        endings
      )}

      <section
        aria-label={t('adoption_forms.lister.interests_label')}
        className="flex flex-col gap-3"
      >
        <h2 className="m-0 text-2xl font-extrabold">
          {t('adoption_forms.lister.interests_title', { count: listing.interests.length })}
        </h2>
        {listing.interests.length === 0 ? (
          <Notice tone="neutral" title={t('adoption_forms.lister.empty_title')}>
            {t('adoption_forms.lister.empty_body')}
          </Notice>
        ) : (
          <>
            <Notice tone="warning">{t('adoption_forms.lister.safety')}</Notice>
            <ul className="m-0 flex list-none flex-col gap-3 p-0">
              {listing.interests.map((interest) => (
                <InterestRow
                  key={interest.id}
                  code={listing.code}
                  interest={interest}
                  someoneChosen={isReserved(listing.interests)}
                  now={now}
                />
              ))}
            </ul>
          </>
        )}
      </section>
    </>
  )
}

function InterestRow({
  code,
  interest,
  someoneChosen,
  now,
}: {
  code: string
  interest: AdoptionInterest
  someoneChosen: boolean
  now: Date
}) {
  const i18n = useI18n()
  const { t } = i18n
  const answer = useAnswerInterest(code)
  const { person, intro } = interest
  const chips = [
    t(`adoption_forms.lister.chip.${intro.housing}`),
    t(intro.hasYard ? 'adoption_forms.lister.chip.yard' : 'adoption_forms.lister.chip.no_yard'),
    intro.otherPets ? t('adoption_forms.lister.other_pets', { text: intro.otherPets }) : null,
    intro.household ? t('adoption_forms.lister.household', { text: intro.household }) : null,
  ].filter((chip): chip is string => chip !== null)
  const facts = [
    person.city,
    memberSince(i18n, person.memberSince, now),
    person.sightingsReported > 0
      ? t('adoption_forms.lister.sightings', { count: person.sightingsReported })
      : null,
    t('adoption_forms.lister.open_interests', { count: person.openAdoptionInterests }),
  ].filter(Boolean)

  return (
    <li
      aria-label={person.displayName}
      className={`flex flex-col gap-3 rounded-2xl border-2 p-4 ${
        interest.status === 'chosen' ? 'border-adoption' : 'border-line'
      } ${interest.status === 'declined' ? 'opacity-60' : ''}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <strong>{person.displayName}</strong>
        <span className="text-muted">· {i18n.relative(interest.createdAt, now)}</span>
        {interest.status !== 'open' ? (
          <Badge tone={interest.status === 'chosen' ? 'adoption' : 'info'}>
            {t(`adoption_forms.lister.status.${interest.status}`)}
          </Badge>
        ) : null}
      </div>
      <p className="m-0 text-sm text-muted">{facts.join(' · ')}</p>
      <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
        {chips.map((chip) => (
          <li key={chip} className="rounded-full bg-soft px-3 py-1 text-sm font-semibold">
            {chip}
          </li>
        ))}
      </ul>
      <p className="m-0">«{intro.why}»</p>
      {interest.whatsappUrl ? (
        <a
          href={interest.whatsappUrl}
          target="_blank"
          rel="noreferrer"
          className={buttonClass('whatsapp')}
        >
          <WhatsAppIcon />
          {t('adoption_forms.lister.write')}
        </a>
      ) : null}
      <div className="flex gap-2">
        {interestMoves(interest.status, someoneChosen).map((move) => (
          <Button
            key={move}
            variant={move === 'choose' ? 'primary' : 'outline'}
            disabled={answer.isPending}
            onClick={() => answer.mutate({ interestId: interest.id, status: MOVE_STATUS[move] })}
          >
            {t(`adoption_forms.lister.moves.${move}`)}
          </Button>
        ))}
      </div>
      {answer.isError ? (
        <Notice tone="warning">{t('adoption_forms.lister.answer_failed')}</Notice>
      ) : null}
    </li>
  )
}
