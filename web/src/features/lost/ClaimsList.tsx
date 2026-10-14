import { useAnswerClaim } from '@api-client/owner'
import type { RecoveryClaim } from '@contracts/case'
import { useI18n } from '@i18n/react'
import { WhatsAppIcon } from '@ui/BrandIcons'
import { Button, buttonClass } from '@ui/Button'
import { Notice } from '@ui/Notice'
import { Phone } from 'lucide-react'

type Props = {
  code: string
  petName: string
  claims: readonly RecoveryClaim[]
  now: Date
  /** The owner chose `in_app_only`: writing from their own phone reveals their number. */
  revealsOwnNumber: boolean
  /** After «Sí, es ella»: the next step is closing the case. */
  onConfirmed: () => void
}

/**
 * The owner's side of «Lo tengo» (docs/product/04 · recovery_claim, docs/eng/auth.md): each open
 * claim's number as buttons — never text to retype — and the answer the owner owes it.
 */
export function ClaimsList({ code, petName, claims, now, revealsOwnNumber, onConfirmed }: Props) {
  const i18n = useI18n()
  const { t } = i18n
  const answer = useAnswerClaim(code)
  const open = claims.filter((claim) => claim.status === 'open')
  if (open.length === 0) return null

  return (
    <section className="flex flex-col gap-3" aria-label={t('lost.claims.label')}>
      <h2 className="m-0 text-2xl font-extrabold">{t('lost.claims.title')}</h2>
      {revealsOwnNumber ? <Notice tone="warning">{t('lost.claims.reveals_number')}</Notice> : null}
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {open.map((claim) => (
          <li key={claim.id} className="flex flex-col gap-3 rounded-2xl border-2 border-brand p-4">
            <p className="m-0">
              <strong>{claim.phone}</strong>{' '}
              <span className="text-muted">· {i18n.relative(claim.createdAt, now)}</span>
            </p>
            <div className="flex gap-2">
              <a
                href={`https://wa.me/${claim.phone.replace('+', '')}`}
                target="_blank"
                rel="noreferrer"
                className={buttonClass('whatsapp')}
              >
                <WhatsAppIcon />
                {t('contact.open_whatsapp')}
              </a>
              <a href={`tel:${claim.phone}`} className={buttonClass('secondary')}>
                <Phone aria-hidden="true" />
                {t('lost.claims.call')}
              </a>
            </div>
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
                {t('lost.claims.confirm', { name: petName })}
              </Button>
              <Button
                variant="outline"
                disabled={answer.isPending}
                onClick={() => answer.mutate({ claimId: claim.id, status: 'dismissed' })}
              >
                {t('lost.claims.dismiss')}
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {answer.isError ? (
        <Notice tone="warning" title={t('lost.claims.failed_title')}>
          {t('common.try_again')}
        </Notice>
      ) : null}
    </section>
  )
}
