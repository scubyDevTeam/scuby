import { useConfig, useReportSighting } from '@api-client/actions'
import { ApiError } from '@api-client/http'
import { sightingErrorCopy, validateSighting } from '@domain/lost/sightings'
import type { Area, Point } from '@domain/shared/geo'
import { toE164 } from '@domain/shared/phone'
import { durations } from '@domain/shared/time'
import { getCurrentPosition } from '@platform/location'
import { Button } from '@ui/Button'
import { Chips, type Option } from '@ui/Choice'
import { PhoneField, TextArea, TextField } from '@ui/Field'
import { PickerMap } from '@ui/Map/PickerMap'
import { Notice } from '@ui/Notice'
import { LocateFixed } from 'lucide-react'
import { type FormEvent, useState } from 'react'

type When = 'now' | 'earlier' | 'yesterday' | 'custom'

const whenOptions: Option<When>[] = [
  { value: 'now', label: 'Ahora' },
  { value: 'earlier', label: 'Hace un rato' },
  { value: 'yesterday', label: 'Ayer' },
  { value: 'custom', label: 'Otra hora' },
]

function seenAtFor(when: When, custom: string, now: Date): Date | null {
  if (when === 'now') return now
  if (when === 'earlier') return new Date(now.getTime() - durations.HOUR)
  if (when === 'yesterday') return new Date(now.getTime() - durations.DAY)
  const parsed = new Date(custom)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

type Props = {
  code: string
  petName: string
  lastSeenPoint: Point
  lastSeenAt: Date
  /** The public area of the case: what the map frames first. */
  area: Area
  mapStyleUrl: string | undefined
  onDone: () => void
}

/** «La vi»: only the pin is required (docs/product/04 · sighting). Everything else is asked, not demanded. */
export function SightingForm({
  code,
  petName,
  lastSeenPoint,
  lastSeenAt,
  area,
  mapStyleUrl,
  onDone,
}: Props) {
  const country = useConfig().data?.countries[0]
  const report = useReportSighting(code)
  const [point, setPoint] = useState<Point | null>(null)
  const [when, setWhen] = useState<When>('now')
  const [custom, setCustom] = useState('')
  const [note, setNote] = useState('')
  const [phone, setPhone] = useState('')
  const [tried, setTried] = useState(false)
  const [locating, setLocating] = useState<'idle' | 'asking' | 'failed'>('idle')

  const now = new Date()
  const seenAt = seenAtFor(when, custom, now)
  // The same checks the server runs, shown the moment the pin lands or the time changes.
  const ruleErrors =
    point && seenAt
      ? validateSighting({ point, seenAt }, { lastSeenPoint, lastSeenAt, petName }, now)
      : []
  const placeError = !point
    ? tried
      ? `Marca en el mapa dónde viste a ${petName}`
      : null
    : ruleErrors.includes('too_far')
      ? sightingErrorCopy('too_far', petName)
      : null
  const timeRule = ruleErrors.find((error) => error !== 'too_far')
  const timeError = !seenAt
    ? tried
      ? 'Dinos a qué hora fue'
      : null
    : timeRule
      ? sightingErrorCopy(timeRule, petName)
      : null
  const contactPhone = phone.trim() && country ? toE164(phone, toRules(country)) : null
  const phoneError = phone.trim() && !contactPhone ? 'Revisa el número de celular' : null

  async function useMyLocation() {
    setLocating('asking')
    const position = await getCurrentPosition()
    if (position) setPoint(position)
    setLocating(position ? 'idle' : 'failed')
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    setTried(true)
    if (!point || !seenAt || ruleErrors.length > 0 || phoneError) return
    report.mutate({ point, seenAt, note: note.trim() || null, contactPhone })
  }

  if (report.isSuccess) {
    return (
      <div className="flex flex-col gap-4">
        <Notice tone="success" title="¡Gracias!">
          Tu avistamiento ya está en el mapa y su familia fue avisada.
        </Notice>
        <Button onClick={onDone}>Listo</Button>
      </div>
    )
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <section className="flex flex-col gap-2">
        <p className="m-0 text-muted">Toca el mapa para marcar el punto.</p>
        <PickerMap
          styleUrl={mapStyleUrl}
          area={area}
          value={point}
          onChange={setPoint}
          unavailable={
            <Notice tone="neutral" title="No pudimos cargar el mapa.">
              Usa tu ubicación para marcar el punto.
            </Notice>
          }
        />
        <Button variant="secondary" onClick={useMyLocation} disabled={locating === 'asking'}>
          <LocateFixed aria-hidden="true" />
          {locating === 'asking' ? 'Buscando tu ubicación…' : 'Usar mi ubicación'}
        </Button>
        {locating === 'failed' ? (
          <p className="m-0 text-sm text-muted">
            No pudimos obtener tu ubicación. Toca el mapa para marcar el punto.
          </p>
        ) : null}
        {point && !placeError ? (
          <p className="m-0 text-sm font-semibold text-found">Punto marcado.</p>
        ) : null}
        {placeError ? (
          <p role="alert" className="m-0 text-sm font-semibold text-lost-deep">
            {placeError}
          </p>
        ) : null}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="m-0 text-lg font-bold">¿Cuándo?</h3>
        <Chips label="¿Cuándo la viste?" options={whenOptions} value={when} onChange={setWhen} />
        {when === 'custom' ? (
          <TextField
            label="Día y hora"
            type="datetime-local"
            value={custom}
            onChange={(event) => setCustom(event.target.value)}
          />
        ) : null}
        {timeError ? (
          <p role="alert" className="m-0 text-sm font-semibold text-lost-deep">
            {timeError}
          </p>
        ) : null}
      </section>

      <TextArea
        label="Nota"
        optional
        placeholder="Hacia dónde iba, cómo se veía…"
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />

      <div className="rounded-2xl bg-brand-mist p-4">
        <PhoneField
          label="Tu WhatsApp"
          optional
          prefix={country?.phonePrefix ?? ''}
          hint="Su familia va a querer preguntarte en qué esquina exactamente. Solo ella lo ve."
          error={phoneError}
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
        />
      </div>

      {report.isError ? (
        <Notice tone="warning" title="No pudimos enviar tu avistamiento.">
          {report.error instanceof ApiError && report.error.kind === 'rejected'
            ? 'Ya registraste un avistamiento hace poco.'
            : 'Revisa tu conexión e inténtalo de nuevo.'}
        </Notice>
      ) : null}

      <Button type="submit" disabled={report.isPending}>
        {report.isPending ? 'Enviando…' : 'Enviar avistamiento'}
      </Button>
      <p className="m-0 text-center text-sm text-muted">Sin cuenta.</p>
    </form>
  )
}

const toRules = (country: { phonePrefix: string; mobilePattern: string }) => ({
  prefix: country.phonePrefix,
  mobilePattern: country.mobilePattern,
})
