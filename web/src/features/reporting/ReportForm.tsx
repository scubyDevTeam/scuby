import { useSendReport } from '@api-client/actions'
import {
  REPORT_REASONS,
  type ReportReason,
  type ReportTarget,
  reportEffect,
} from '@domain/shared/report'
import { Button } from '@ui/Button'
import { RadioList, TextArea } from '@ui/Field'
import { Notice } from '@ui/Notice'
import { type FormEvent, useState } from 'react'

const reasonLabel: Record<ReportReason, string> = {
  scam_or_extortion: 'Estafa o piden dinero',
  personal_data: 'Muestra datos personales',
  animal_welfare: 'El animal está en malas condiciones',
  graphic_content: 'Contenido gráfico o violento',
  harassment: 'Acoso',
  duplicate: 'Está repetida',
  spam: 'Spam',
  other: 'Otra cosa',
}

const options = REPORT_REASONS.map((value) => ({ value, label: reasonLabel[value] }))

const effectCopy = {
  queued: 'Una persona la revisará. Mientras tanto la publicación sigue visible.',
  hidden_pending_review:
    'Por este motivo la ocultamos de inmediato mientras una persona la revisa, en menos de 4 horas.',
  suspended_pending_review:
    'Por este motivo la pausamos de inmediato mientras una persona la revisa, en menos de 4 horas.',
} as const

type Props = { targetType: ReportTarget; targetCode: string; onDone: () => void }

/** docs/product/09: anonymous and one tap — a reason is required, nothing else is. */
export function ReportForm({ targetType, targetCode, onDone }: Props) {
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
        <Notice tone="success" title="Gracias por avisar.">
          Recibimos tu reporte.
        </Notice>
        <Button onClick={onDone}>Listo</Button>
      </div>
    )
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <p className="m-0 text-muted">
        Es anónimo y no necesitas cuenta. Quien publicó nunca sabrá quién reportó.
      </p>
      <RadioList
        legend="Motivo del reporte"
        name="reason"
        options={options}
        value={reason}
        onChange={setReason}
      />
      {tried && !reason ? (
        <p role="alert" className="m-0 text-sm font-semibold text-lost-deep">
          Elige un motivo
        </p>
      ) : null}
      <TextArea
        label="Cuéntanos más"
        optional
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />
      {reason ? (
        <p className="m-0 text-sm text-muted">{effectCopy[reportEffect(reason, targetType)]}</p>
      ) : null}
      {send.isError ? (
        <Notice tone="warning" title="No pudimos enviar el reporte.">
          Revisa tu conexión e inténtalo de nuevo.
        </Notice>
      ) : null}
      <Button type="submit" disabled={send.isPending}>
        {send.isPending ? 'Enviando…' : 'Enviar reporte'}
      </Button>
    </form>
  )
}
