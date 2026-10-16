import { useAnswerPledge, useCoverNeed, useStillNeeded } from '@api-client/help'
import type { BeneficiaryPledge, HelpCase } from '@contracts/help-case'
import { pledgeMoves } from '@domain/help/machine'
import { useI18n } from '@i18n/react'
import { Badge } from '@ui/Badge'
import { WhatsAppIcon } from '@ui/BrandIcons'
import { Button, buttonClass } from '@ui/Button'
import { Notice } from '@ui/Notice'
import { Phone } from 'lucide-react'

type Props = {
  request: HelpCase
  now: Date
  /** «Ya no necesita ayuda» → its reason. */
  onClose: () => void
}

/**
 * What only the beneficiary sees (docs/product/07): who offered what, how to reach them, and the
 * only word that counts — that it arrived. A promise is not a ride: nothing is covered until the
 * beneficiary confirms it.
 */
export function BeneficiaryPanel({ request, now, onClose }: Props) {
  const { t } = useI18n()
  const stillNeeded = useStillNeeded(request.code)
  const cover = useCoverNeed(request.code)
  if (request.viewer !== 'beneficiary' || request.status !== 'active') return null

  const name = request.pet.name
  const checkin = request.pendingCheckin

  return (
    <>
      {checkin ? (
        <section
          aria-label={t('help.checkin.title', { name })}
          className="flex flex-col gap-3 rounded-2xl bg-brand-mist p-4"
        >
          <p className="m-0 font-bold">{t('help.checkin.title', { name })}</p>
          <p className="m-0 text-muted">{t('help.checkin.body')}</p>
          <Button disabled={stillNeeded.isPending} onClick={() => stillNeeded.mutate(checkin.id)}>
            {t('help.checkin.still')}
          </Button>
          <Button variant="outline" onClick={onClose}>
            {t('help.checkin.ended')}
          </Button>
        </section>
      ) : null}

      <section aria-label={t('help_forms.beneficiary.title')} className="flex flex-col gap-3">
        <h2 className="m-0 text-2xl font-extrabold">{t('help_forms.beneficiary.title')}</h2>
        {request.pledges.length === 0 ? (
          <Notice tone="neutral">{t('help_forms.beneficiary.none')}</Notice>
        ) : (
          <>
            <Notice tone="warning">{t('help.page.safety')}</Notice>
            {request.needs.map((need) => {
              const pledges = request.pledges.filter((pledge) => pledge.needId === need.id)
              const kind = t(`help.need.kind.${need.kind}`)
              return (
                <div key={need.id} className="flex flex-col gap-2">
                  <h3 className="m-0 text-lg font-bold">{kind}</h3>
                  <ul aria-label={kind} className="m-0 flex list-none flex-col gap-3 p-0">
                    {pledges.map((pledge) => (
                      <PledgeRow key={pledge.id} code={request.code} pledge={pledge} now={now} />
                    ))}
                  </ul>
                  {need.status === 'open' ? (
                    <Button
                      variant="secondary"
                      disabled={cover.isPending}
                      onClick={() => cover.mutate(need.id)}
                    >
                      {t('help_forms.beneficiary.cover')}
                    </Button>
                  ) : null}
                </div>
              )
            })}
          </>
        )}
        {cover.isError ? (
          <Notice tone="warning">{t('help_forms.beneficiary.answer_failed')}</Notice>
        ) : null}
      </section>
    </>
  )
}

function PledgeRow({ code, pledge, now }: { code: string; pledge: BeneficiaryPledge; now: Date }) {
  const i18n = useI18n()
  const { t } = i18n
  const answer = useAnswerPledge(code)
  return (
    <li
      aria-label={pledge.personName}
      className={`flex flex-col gap-3 rounded-2xl border-2 p-4 ${
        pledge.status === 'confirmed' ? 'border-found' : 'border-line'
      } ${pledge.status === 'declined' ? 'opacity-60' : ''}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <strong>{pledge.personName}</strong>
        <span className="text-muted">· {i18n.relative(pledge.createdAt, now)}</span>
        {pledge.status !== 'pledged' ? (
          <Badge tone={pledge.status === 'confirmed' ? 'found' : 'info'}>
            {t(`help_forms.beneficiary.${pledge.status}`)}
          </Badge>
        ) : null}
      </div>
      {pledge.quantity > 1 ? (
        <p className="m-0 text-muted">
          {t('help_forms.beneficiary.offered', { quantity: pledge.quantity })}
        </p>
      ) : null}
      {pledge.note ? <p className="m-0">«{pledge.note}»</p> : null}
      {pledge.status === 'pledged' ? (
        <>
          <div className="flex gap-2">
            {pledge.whatsappUrl ? (
              <a
                href={pledge.whatsappUrl}
                target="_blank"
                rel="noreferrer"
                className={buttonClass('whatsapp')}
              >
                <WhatsAppIcon />
                {t('help_forms.beneficiary.whatsapp')}
              </a>
            ) : null}
            <a href={`tel:${pledge.phone}`} className={buttonClass('secondary')}>
              <Phone aria-hidden="true" />
              {t('help_forms.beneficiary.call')}
            </a>
          </div>
          <div className="flex gap-2">
            {pledgeMoves(pledge.status).map((move) => (
              <Button
                key={move}
                variant={move === 'confirm' ? 'primary' : 'outline'}
                disabled={answer.isPending}
                onClick={() =>
                  answer.mutate({
                    pledgeId: pledge.id,
                    status: move === 'confirm' ? 'confirmed' : 'declined',
                  })
                }
              >
                {t(`help_forms.beneficiary.${move}`)}
              </Button>
            ))}
          </div>
        </>
      ) : null}
      {answer.isError ? (
        <Notice tone="warning">{t('help_forms.beneficiary.answer_failed')}</Notice>
      ) : null}
    </li>
  )
}
