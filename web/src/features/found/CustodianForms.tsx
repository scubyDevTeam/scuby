import { useResolveFound } from '@api-client/found'
import type { ResolveInput } from '@contracts/found'
import { Button } from '@ui/Button'
import { RadioList, TextField } from '@ui/Field'
import { Notice } from '@ui/Notice'
import { type FormEvent, type ReactNode, useState } from 'react'

/** «¿Quién te ayudó?» — the found flow's own list (docs/product/05 · resolution_attribution). */
const attributions = [
  { value: 'platform_claim', label: 'Su dueño lo vio aquí y me escribió' },
  { value: 'platform_match', label: 'La app nos avisó que coincidían' },
  { value: 'platform_share', label: 'Vieron el aviso compartido' },
  { value: 'offline', label: 'Lo encontré por otro lado' },
  { value: 'unknown', label: 'No sé' },
] as const

const cancelReasons = [
  { value: 'not_a_stray', label: 'No estaba perdido' },
  { value: 'ran_off_again', label: 'Se fue de nuevo' },
  { value: 'duplicate', label: 'Lo publiqué dos veces' },
] as const

export type Outcome = 'reunited' | 'kept' | 'transferred_to_org' | 'cancelled'

type Props = { code: string; outcome: Outcome; suggested: string | null; onDone: () => void }

/** The honourable endings of custody, each a declaration by the custodian and by nobody else. */
export function ResolveForm({ code, outcome, suggested, onDone }: Props) {
  const resolve = useResolveFound(code)
  const [choice, setChoice] = useState<string | null>(outcome === 'reunited' ? suggested : null)
  const [orgName, setOrgName] = useState('')
  const [tried, setTried] = useState(false)
  const needsChoice = outcome === 'reunited' || outcome === 'cancelled'

  function submit(event: FormEvent) {
    event.preventDefault()
    setTried(true)
    if (needsChoice && !choice) return
    const input: ResolveInput =
      outcome === 'reunited'
        ? { outcome, attribution: choice ?? 'unknown' }
        : outcome === 'cancelled'
          ? { outcome, reason: choice ?? 'duplicate' }
          : outcome === 'transferred_to_org'
            ? { outcome, orgName: orgName.trim() || null }
            : { outcome }
    resolve.mutate(input, { onSuccess: onDone })
  }

  const body: Record<Outcome, { intro: ReactNode; button: string; danger?: boolean }> = {
    reunited: {
      intro: 'Qué alegría. Cuéntanos cómo se encontraron: así sabemos qué funciona.',
      button: 'Sí, ya está con su dueño',
    },
    kept: {
      intro:
        'Queda registrado desde hoy. Si puedes, espera unos días más antes de decidir: su familia puede estar buscándolo. Si aparece, todavía podrá escribirte.',
      button: 'Me lo quedo',
    },
    transferred_to_org: {
      intro: 'Gracias por buscarle un lugar. El aviso se cierra.',
      button: 'Confirmar entrega',
    },
    cancelled: { intro: null, button: 'Eliminar aviso', danger: true },
  }
  const current = body[outcome]

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      {current.intro ? <p className="m-0 text-muted">{current.intro}</p> : null}
      {outcome === 'reunited' ? (
        <RadioList
          legend="¿Quién te ayudó?"
          name="attribution"
          options={attributions}
          value={choice}
          onChange={setChoice}
        />
      ) : null}
      {outcome === 'cancelled' ? (
        <RadioList
          legend="¿Por qué lo eliminas?"
          name="reason"
          options={cancelReasons}
          value={choice}
          onChange={setChoice}
        />
      ) : null}
      {outcome === 'transferred_to_org' ? (
        <TextField
          label="¿A cuál fundación?"
          optional
          value={orgName}
          onChange={(event) => setOrgName(event.target.value)}
        />
      ) : null}
      {tried && needsChoice && !choice ? (
        <p role="alert" className="m-0 text-sm font-semibold text-lost-deep">
          Elige una opción
        </p>
      ) : null}
      {resolve.isError ? (
        <Notice tone="warning" title="No pudimos guardarlo.">
          Revisa tu conexión e inténtalo de nuevo.
        </Notice>
      ) : null}
      <Button
        type="submit"
        variant={current.danger ? 'danger' : 'primary'}
        disabled={resolve.isPending}
      >
        {resolve.isPending ? 'Guardando…' : current.button}
      </Button>
    </form>
  )
}
