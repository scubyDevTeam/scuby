import { useAnswerOwnershipClaim, useResolveFound } from '@api-client/found'
import type { FoundCase } from '@contracts/found'
import { evidenceTier } from '@domain/found/evidence'
import { holdOfferDue } from '@domain/found/machine'
import { useI18n } from '@i18n/react'
import { WhatsAppIcon } from '@ui/BrandIcons'
import { Button, buttonClass } from '@ui/Button'
import { Notice } from '@ui/Notice'
import type { ReactNode } from 'react'
import { tierLabel } from './copy'

type Props = {
  foundCase: FoundCase
  now: Date
  /** After «Sí, es el dueño»: the next step is closing the case. */
  onConfirmed: () => void
  onKeep: () => void
  onTransfer: () => void
  /** «Publicar en adopción»: the link to the listing form, pre-filled from this case (05 · 06). */
  adoptionLink: ReactNode
}

/**
 * What only the custodian sees (docs/product/05): each «Es mío» with its evidence labelled by how
 * hard it is to fake, the detail they withheld replayed to them, and the day-15 offer.
 */
export function CustodianPanel({
  foundCase,
  now,
  onConfirmed,
  onKeep,
  onTransfer,
  adoptionLink,
}: Props) {
  const i18n = useI18n()
  const { t } = i18n
  const answer = useAnswerOwnershipClaim(foundCase.code)
  const resolve = useResolveFound(foundCase.code)
  if (foundCase.viewer !== 'custodian' || foundCase.status !== 'active') return null

  const open = foundCase.ownershipClaims.filter((claim) => claim.status === 'open')
  const offer = holdOfferDue(
    {
      status: foundCase.status,
      offerAt: foundCase.holdOfferAt,
      hasConfirmedClaim: foundCase.ownershipClaims.some((claim) => claim.status === 'confirmed'),
    },
    now,
  )

  return (
    <>
      {offer ? (
        <section
          aria-label={t('found.custodian.offer_label')}
          className="flex flex-col gap-3 rounded-2xl bg-brand-mist p-4"
        >
          {/* An offer, not a warning: a finder has nothing to lose, the animal has a future to gain. */}
          <p className="m-0 font-bold">{t('found.custodian.offer_title')}</p>
          <p className="m-0 text-muted">{t('found.custodian.offer_body')}</p>
          {adoptionLink}
          <Button variant="outline" onClick={onTransfer}>
            {t('found.actions.transfer')}
          </Button>
          <Button variant="outline" onClick={onKeep}>
            {t('found.actions.keep')}
          </Button>
          <Button
            variant="secondary"
            disabled={resolve.isPending}
            onClick={() => resolve.mutate({ outcome: 'keep_searching' })}
          >
            {t('found.custodian.keep_searching')}
          </Button>
        </section>
      ) : null}

      {open.length > 0 ? (
        <section className="flex flex-col gap-3" aria-label={t('found.custodian.claims_label')}>
          <h2 className="m-0 text-2xl font-extrabold">{t('found.custodian.claims_title')}</h2>
          {foundCase.withheldDetail ? (
            <Notice
              title={t('found.custodian.withheld_title', { detail: foundCase.withheldDetail })}
            >
              {t('found.custodian.withheld_body')}
            </Notice>
          ) : null}
          <Notice tone="warning">{t('found.safety')}</Notice>
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {open.map((claim) => (
              <li
                key={claim.id}
                className="flex flex-col gap-3 rounded-2xl border-2 border-brand p-4"
              >
                <p className="m-0">
                  <strong>{claim.claimantName}</strong>{' '}
                  <span className="text-muted">· {i18n.relative(claim.createdAt, now)}</span>
                </p>
                <p className="m-0 font-semibold">
                  {t(
                    tierLabel[
                      evidenceTier({
                        fromLostCaseCode: claim.fromLostCaseCode,
                        notes: claim.evidenceNotes,
                        chipNumber: claim.chipNumber,
                        photoCount: claim.photoCount,
                      })
                    ],
                  )}
                </p>
                {claim.evidenceNotes ? (
                  <p className="m-0 text-muted">«{claim.evidenceNotes}»</p>
                ) : null}
                {claim.chipNumber ? (
                  <p className="m-0 text-muted">
                    {t('found.custodian.microchip', { chip: claim.chipNumber })}
                  </p>
                ) : null}
                {claim.whatsappUrl ? (
                  <a
                    href={claim.whatsappUrl}
                    target="_blank"
                    rel="noreferrer"
                    className={buttonClass('whatsapp')}
                  >
                    <WhatsAppIcon />
                    {t('contact.open_whatsapp')}
                  </a>
                ) : null}
                <div className="flex gap-2">
                  <Button
                    disabled={answer.isPending}
                    onClick={() =>
                      answer.mutate(
                        { claimId: claim.id, status: 'confirmed' },
                        { onSuccess: onConfirmed },
                      )
                    }
                  >
                    {t('found.custodian.confirm')}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={answer.isPending}
                    onClick={() => answer.mutate({ claimId: claim.id, status: 'dismissed' })}
                  >
                    {t('found.custodian.dismiss')}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          {answer.isError ? (
            <Notice tone="warning" title={t('found.custodian.answer_failed')}>
              {t('common.try_again')}
            </Notice>
          ) : null}
        </section>
      ) : null}
    </>
  )
}
