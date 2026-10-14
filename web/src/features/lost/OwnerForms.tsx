import { useCancelCase, useReopenCase, useReunite } from '@api-client/owner'
import {
  ATTRIBUTIONS,
  type Attribution,
  CANCEL_REASONS,
  type CancelReason,
} from '@domain/lost/resolution'
import { Button } from '@ui/Button'
import { RadioList } from '@ui/Field'
import { Notice } from '@ui/Notice'
import { type FormEvent, useState } from 'react'

const attributionLabel: Record<Attribution, string> = {
  platform_sighting: 'Alguien la vio y avisó aquí',
  platform_claim: 'Alguien la tenía y avisó aquí',
  platform_share: 'Alguien vio el aviso compartido o el afiche',
  offline: 'Apareció por otro lado',
  unknown: 'No sé',
}

const cancelLabel: Record<CancelReason, string> = {
  false_alarm: 'Fue una falsa alarma',
  duplicate: 'Lo publiqué dos veces',
}

const failed = (
  <Notice tone="warning" title="No pudimos guardarlo.">
    Revisa tu conexión e inténtalo de nuevo.
  </Notice>
)

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
      <p className="m-0 text-muted">
        Qué alegría. Cuéntanos quién te ayudó a encontrar a {petName}: así sabemos qué funciona.
      </p>
      <RadioList
        legend="¿Quién te ayudó?"
        name="attribution"
        options={ATTRIBUTIONS.map((value) => ({ value, label: attributionLabel[value] }))}
        value={attribution}
        onChange={setAttribution}
      />
      {tried && !attribution ? (
        <p role="alert" className="m-0 text-sm font-semibold text-lost-deep">
          Elige una opción
        </p>
      ) : null}
      {reunite.isError ? failed : null}
      <Button type="submit" disabled={reunite.isPending}>
        {reunite.isPending ? 'Guardando…' : `Sí, ${petName} ya está en casa`}
      </Button>
      <p className="m-0 text-center text-sm text-muted">
        El aviso se cierra y dejamos de avisar a los vecinos.
      </p>
    </form>
  )
}

/** «Eliminar aviso»: cancels the case. The pet stays in the account. */
export function CancelForm({ code, onDone }: { code: string; onDone: () => void }) {
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
      <Notice tone="warning">
        Si ya apareció, no lo elimines: usa «Ya apareció» para que quede registrado el reencuentro.
      </Notice>
      <RadioList
        legend="¿Por qué lo eliminas?"
        name="reason"
        options={CANCEL_REASONS.map((value) => ({ value, label: cancelLabel[value] }))}
        value={reason}
        onChange={setReason}
      />
      {tried && !reason ? (
        <p role="alert" className="m-0 text-sm font-semibold text-lost-deep">
          Elige un motivo
        </p>
      ) : null}
      {cancel.isError ? failed : null}
      <Button type="submit" variant="danger" disabled={cancel.isPending}>
        {cancel.isPending ? 'Eliminando…' : 'Eliminar aviso'}
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
  const reopen = useReopenCase(code)
  return (
    <div className="flex flex-col gap-4">
      <p className="m-0 text-muted">
        El aviso de {petName} vuelve a estar activo y conserva sus avistamientos.
      </p>
      {reopen.isError ? failed : null}
      <Button
        disabled={reopen.isPending}
        onClick={() => reopen.mutate(undefined, { onSuccess: onDone })}
      >
        {reopen.isPending ? 'Reactivando…' : 'Reactivar aviso'}
      </Button>
    </div>
  )
}
