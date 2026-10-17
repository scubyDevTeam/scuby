import { useAnswerCheckin } from '@api-client/owner'
import type { Checkin } from '@contracts/case'
import { type CheckinResponse, checkinStep } from '@domain/lost/checkin'
import { useI18n } from '@i18n/react'
import type { TextKey } from '@i18n/translate'
import { Button, type ButtonVariant } from '@ui/Button'
import { Notice } from '@ui/Notice'
import { formatDayMonth } from './copy'

const answerLabel: Record<CheckinResponse, TextKey> = {
  still_lost: 'lost_forms.checkin.answers.still_lost',
  reunited: 'lost_forms.checkin.answers.reunited',
  delete: 'lost_forms.checkin.answers.delete',
  claim_confirmed: 'lost_forms.checkin.answers.claim_confirmed',
  claim_dismissed: 'lost_forms.checkin.answers.claim_dismissed',
  still_verifying: 'lost_forms.checkin.answers.still_verifying',
}

const answerVariant: Record<CheckinResponse, ButtonVariant> = {
  still_lost: 'primary',
  reunited: 'outline',
  delete: 'link',
  claim_confirmed: 'primary',
  claim_dismissed: 'outline',
  still_verifying: 'secondary',
}

type Props = {
  code: string
  petName: string
  checkin: Checkin
  /** The answers this check-in takes, in order (domain/lost/checkin). */
  answers: readonly CheckinResponse[]
  /** The number behind a claim check-in, when the claim is still in the case's list. */
  claimPhone: string | null
  /** «Ya apareció» and «Eliminar» continue in the case's own close and delete forms. */
  onReunited: () => void
  onDelete: () => void
}

/**
 * The question the owner owes an answer to (docs/product/04 · The follow-up loop), framed as
 * «this goes away unless you keep it», never «did you find your pet?».
 */
export function CheckinCard({
  code,
  petName,
  checkin,
  answers,
  claimPhone,
  onReunited,
  onDelete,
}: Props) {
  const i18n = useI18n()
  const { t } = i18n
  const answer = useAnswerCheckin(code)
  const isClaim = checkin.trigger === 'post_recovery_claim'

  function choose(response: CheckinResponse) {
    const step = checkinStep(response)
    if (step === 'ask_attribution') return onReunited()
    if (step === 'ask_reason') return onDelete()
    answer.mutate({ checkinId: checkin.id, response })
  }

  return (
    <section
      aria-label={t('lost_forms.checkin.label')}
      className="flex flex-col gap-3 rounded-2xl border-2 border-lost bg-lost-soft p-4 text-lost-ink"
    >
      <p className="m-0">
        <strong>
          {t(isClaim ? 'lost_forms.checkin.claim_title' : 'lost_forms.checkin.time_based_title', {
            name: petName,
          })}
        </strong>{' '}
        {isClaim
          ? t('lost_forms.checkin.claim_body')
          : checkin.archivesAt
            ? t('lost_forms.checkin.time_based_body_dated', {
                date: formatDayMonth(i18n, checkin.archivesAt),
              })
            : t('lost_forms.checkin.time_based_body')}
      </p>
      {isClaim && claimPhone ? (
        <p className="m-0 text-sm">{t('lost_forms.checkin.claim_phone', { phone: claimPhone })}</p>
      ) : null}
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        {answers.map((response) => (
          <Button
            key={response}
            variant={answerVariant[response]}
            className={response === 'delete' ? 'text-lost-deep' : ''}
            disabled={answer.isPending}
            onClick={() => choose(response)}
          >
            {t(answerLabel[response], { name: petName })}
          </Button>
        ))}
      </div>
      {answer.isError ? (
        <Notice tone="warning" title={t('lost_forms.checkin.failed_title')}>
          {t('common.try_again')}
        </Notice>
      ) : null}
    </section>
  )
}
