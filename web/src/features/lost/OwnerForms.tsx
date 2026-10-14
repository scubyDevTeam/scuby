import { useCancelCase, useReopenCase, useReunite } from '@api-client/owner'
import {
  ATTRIBUTIONS,
  type Attribution,
  CANCEL_REASONS,
  type CancelReason,
} from '@domain/lost/resolution'
import { useI18n } from '@i18n/react'
import type { TextKey } from '@i18n/translate'
import { Button } from '@ui/Button'
import { RadioList } from '@ui/Field'
import { Notice } from '@ui/Notice'
import { type FormEvent, useState } from 'react'

const attributionLabel: Record<Attribution, TextKey> = {
  platform_sighting: 'lost.owner_forms.attribution.platform_sighting',
  platform_claim: 'lost.owner_forms.attribution.platform_claim',
  platform_share: 'lost.owner_forms.attribution.platform_share',
  offline: 'lost.owner_forms.attribution.offline',
  unknown: 'common.not_sure',
}

const cancelLabel: Record<CancelReason, TextKey> = {
  false_alarm: 'lost.owner_forms.cancel_reason.false_alarm',
  duplicate: 'lost.owner_forms.cancel_reason.duplicate',
}

function Failed() {
  const { t } = useI18n()
  return (
    <Notice tone="warning" title={t('common.save_failed')}>
      {t('common.check_connection')}
    </Notice>
  )
}

/** «Ya apareció»: closes the case as reunited and asks who helped. */
export function ReuniteForm({
  code,
  petName,
  suggested,
  onDone,
}: {
  code: string
  petName: string
  suggested: Attribution | null
  onDone: () => void
}) {
  const { t } = useI18n()
  const reunite = useReunite(code)
  const [attribution, setAttribution] = useState<Attribution | null>(suggested)
  const [tried, setTried] = useState(false)

  function submit(event: FormEvent) {
    event.preventDefault()
    setTried(true)
    if (attribution) reunite.mutate({ attribution }, { onSuccess: onDone })
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <p className="m-0 text-muted">{t('lost.owner_forms.reunite_intro', { name: petName })}</p>
      <RadioList
        legend={t('lost.owner_forms.who_helped')}
        name="attribution"
        options={ATTRIBUTIONS.map((value) => ({ value, label: t(attributionLabel[value]) }))}
        value={attribution}
        onChange={setAttribution}
      />
      {tried && !attribution ? (
        <p role="alert" className="m-0 text-sm font-semibold text-lost-deep">
          {t('lost.owner_forms.pick_option')}
        </p>
      ) : null}
      {reunite.isError ? <Failed /> : null}
      <Button type="submit" disabled={reunite.isPending}>
        {reunite.isPending
          ? t('lost.owner_forms.saving')
          : t('lost.owner_forms.reunite_submit', { name: petName })}
      </Button>
      <p className="m-0 text-center text-sm text-muted">{t('lost.owner_forms.reunite_footnote')}</p>
    </form>
  )
}

/** «Eliminar aviso»: cancels the case. The pet stays in the account. */
export function CancelForm({ code, onDone }: { code: string; onDone: () => void }) {
  const { t } = useI18n()
  const cancel = useCancelCase(code)
  const [reason, setReason] = useState<CancelReason | null>(null)
  const [tried, setTried] = useState(false)

  function submit(event: FormEvent) {
    event.preventDefault()
    setTried(true)
    if (reason) cancel.mutate({ reason }, { onSuccess: onDone })
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <Notice tone="warning">{t('lost.owner_forms.cancel_warning')}</Notice>
      <RadioList
        legend={t('lost.owner_forms.why_cancel')}
        name="reason"
        options={CANCEL_REASONS.map((value) => ({ value, label: t(cancelLabel[value]) }))}
        value={reason}
        onChange={setReason}
      />
      {tried && !reason ? (
        <p role="alert" className="m-0 text-sm font-semibold text-lost-deep">
          {t('lost.owner_forms.pick_reason')}
        </p>
      ) : null}
      {cancel.isError ? <Failed /> : null}
      <Button type="submit" variant="danger" disabled={cancel.isPending}>
        {t(cancel.isPending ? 'lost.owner_forms.deleting' : 'lost.owner_forms.cancel_submit')}
      </Button>
    </form>
  )
}

/** One tap brings an archived case back, with its sightings and trajectory (docs/product/04). */
export function ReopenForm({
  code,
  petName,
  onDone,
}: {
  code: string
  petName: string
  onDone: () => void
}) {
  const { t } = useI18n()
  const reopen = useReopenCase(code)
  return (
    <div className="flex flex-col gap-4">
      <p className="m-0 text-muted">{t('lost.owner_forms.reopen_intro', { name: petName })}</p>
      {reopen.isError ? <Failed /> : null}
      <Button
        disabled={reopen.isPending}
        onClick={() => reopen.mutate(undefined, { onSuccess: onDone })}
      >
        {t(reopen.isPending ? 'lost.owner_forms.reopening' : 'lost.owner_forms.reopen_submit')}
      </Button>
    </div>
  )
}
