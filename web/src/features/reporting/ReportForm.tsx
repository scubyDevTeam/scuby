import { useSendReport } from '@api-client/actions'
import {
  REPORT_REASONS,
  type ReportReason,
  type ReportTarget,
  reportEffect,
} from '@domain/shared/report'
import { useI18n } from '@i18n/react'
import { Button } from '@ui/Button'
import { RadioList, TextArea } from '@ui/Field'
import { Notice } from '@ui/Notice'
import { type FormEvent, useState } from 'react'

type Props = { targetType: ReportTarget; targetCode: string; onDone: () => void }

/** docs/product/09: anonymous and one tap — a reason is required, nothing else is. */
export function ReportForm({ targetType, targetCode, onDone }: Props) {
  const { t } = useI18n()
  const options = REPORT_REASONS.map((value) => ({
    value,
    label: t(`reporting.reasons.${value}`),
  }))
  const send = useSendReport()
  const [reason, setReason] = useState<ReportReason | null>(null)
  const [note, setNote] = useState('')
  const [tried, setTried] = useState(false)

  function submit(event: FormEvent) {
    event.preventDefault()
    setTried(true)
    if (!reason) return
    send.mutate({ targetType, targetCode, reason, note: note.trim() || null })
  }

  if (send.isSuccess) {
    return (
      <div className="flex flex-col gap-4">
        <Notice tone="success" title={t('reporting.thanks')}>
          {t('reporting.received')}
        </Notice>
        <Button onClick={onDone}>{t('common.done')}</Button>
      </div>
    )
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <p className="m-0 text-muted">{t('reporting.intro')}</p>
      <RadioList
        legend={t('reporting.reason_legend')}
        name="reason"
        options={options}
        value={reason}
        onChange={setReason}
      />
      {tried && !reason ? (
        <p role="alert" className="m-0 text-sm font-semibold text-lost-deep">
          {t('reporting.reason_required')}
        </p>
      ) : null}
      <TextArea
        label={t('reporting.note')}
        optional
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />
      {reason ? (
        <p className="m-0 text-sm text-muted">
          {t(`reporting.effect.${reportEffect(reason, targetType)}`)}
        </p>
      ) : null}
      {send.isError ? (
        <Notice tone="warning" title={t('reporting.send_failed')}>
          {t('common.check_connection')}
        </Notice>
      ) : null}
      <Button type="submit" disabled={send.isPending}>
        {t(send.isPending ? 'reporting.sending' : 'reporting.send')}
      </Button>
    </form>
  )
}
