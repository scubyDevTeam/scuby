import { useConfig } from '@api-client/actions'
import { useMatchAnimal, useReportWitness } from '@api-client/found'
import type { Candidate } from '@contracts/found'
import { witnessErrors } from '@domain/found/publish'
import type { Point } from '@domain/shared/geo'
import { toE164 } from '@domain/shared/phone'
import type { Species } from '@domain/shared/publish'
import { messageFor } from '@features/publish/copy'
import { PhotoPicker } from '@features/publish/PhotoPicker'
import { FieldError, Section, useWhen } from '@features/publish/parts'
import { getCurrentPosition } from '@platform/location'
import { Button } from '@ui/Button'
import { Chips, type Option } from '@ui/Choice'
import { PhoneField, TextArea } from '@ui/Field'
import { PickerMap } from '@ui/Map/PickerMap'
import { Notice } from '@ui/Notice'
import { LocateFixed } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { Candidates } from './Candidates'

const speciesOptions: Option<Species>[] = [
  { value: 'dog', label: 'Perro' },
  { value: 'cat', label: 'Gato' },
  { value: 'other', label: 'Otro' },
]

/**
 * «No lo tengo, solo lo vi» (docs/product/05): no account, pin and photo required. If it looks like
 * a pet someone is searching for, the witness confirms and the report joins that case's trail;
 * otherwise it is kept and matched against cases published later. It never becomes a public card.
 */
export function WitnessReport({
  mapStyleUrl,
  onDone,
}: {
  mapStyleUrl: string | undefined
  onDone: () => void
}) {
  const country = useConfig().data?.countries[0]
  const match = useMatchAnimal()
  const report = useReportWitness()
  const when = useWhen()
  const [photoUrls, setPhotoUrls] = useState<string[]>([])
  const [species, setSpecies] = useState<Species | null>(null)
  const [point, setPoint] = useState<Point | null>(null)
  const [note, setNote] = useState('')
  const [phone, setPhone] = useState('')
  const [tried, setTried] = useState(false)
  const [candidates, setCandidates] = useState<Candidate[] | null>(null)

  const now = new Date()
  const errors = witnessErrors({ photoUrls, species, point, seenAt: when.at }, now)
  const errorFor = messageFor(tried ? errors : [])
  const contactPhone =
    phone.trim() && country
      ? toE164(phone, { prefix: country.phonePrefix, mobilePattern: country.mobilePattern })
      : null
  const phoneError = phone.trim() && !contactPhone ? 'Revisa el número de celular' : null

  function send(caseCode: string | null) {
    if (!species || !point || !when.at) return
    report.mutate({
      caseCode,
      species,
      photoUrls,
      point,
      seenAt: when.at,
      note: note.trim() || null,
      contactPhone,
    })
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    setTried(true)
    if (errors.length > 0 || phoneError || !species || !point || !when.at) return
    match.mutate(
      { species, size: null, colors: [], point, at: when.at },
      {
        onSuccess: (found) => (found.length > 0 ? setCandidates(found) : send(null)),
        // Matching being down must not lose the report.
        onError: () => send(null),
      },
    )
  }

  if (report.isSuccess) {
    return (
      <div className="mx-auto flex max-w-lg flex-col gap-5 px-5 py-10">
        <h1 className="m-0 text-3xl font-extrabold">¡Gracias por avisar!</h1>
        <Notice tone="success" title="Guardamos tu reporte.">
          Si alguien busca a un animal así, le avisamos dónde lo viste.
        </Notice>
        <Button onClick={onDone}>Listo</Button>
      </div>
    )
  }

  if (candidates) {
    return (
      <div className="mx-auto flex max-w-lg flex-col gap-5 px-5 py-8">
        <h1 className="m-0 text-3xl font-extrabold">¿Es alguno de estos?</h1>
        <Candidates
          candidates={candidates}
          onPick={(candidate) => send(candidate.code)}
          onNone={() => send(null)}
          noneLabel="No es ninguno"
        />
        {report.isError ? (
          <Notice tone="warning" title="No pudimos guardar tu reporte.">
            Inténtalo de nuevo.
          </Notice>
        ) : null}
      </div>
    )
  }

  return (
    <form onSubmit={submit} noValidate className="mx-auto flex max-w-lg flex-col gap-6 px-5 py-6">
      <h1 className="m-0 text-3xl font-extrabold">¿Dónde lo viste?</h1>
      <Section title="Foto" error={errorFor('photo_required')}>
        <PhotoPicker urls={photoUrls} onChange={setPhotoUrls} />
        <p className="m-0 text-sm text-muted">Sin foto no podemos saber de quién es.</p>
      </Section>
      <Section title="Especie" error={errorFor('species_required')}>
        <Chips
          label="Especie"
          options={speciesOptions}
          value={species ?? ('' as Species)}
          onChange={setSpecies}
        />
      </Section>
      {country ? (
        <section className="flex flex-col gap-2">
          <p className="m-0 text-muted">Toca el mapa para marcar el punto.</p>
          <PickerMap
            styleUrl={mapStyleUrl}
            area={{ center: point ?? country.defaultCenter, radiusM: point ? 800 : 4000 }}
            showArea={false}
            value={point}
            onChange={setPoint}
            unavailable={
              <Notice tone="neutral" title="No pudimos cargar el mapa.">
                Usa tu ubicación para marcar el punto.
              </Notice>
            }
          />
          <Button
            variant="secondary"
            onClick={async () => {
              const position = await getCurrentPosition()
              if (position) setPoint(position)
            }}
          >
            <LocateFixed aria-hidden="true" />
            Usar mi ubicación
          </Button>
          {point ? <p className="m-0 text-sm font-semibold text-found">Punto marcado.</p> : null}
          <FieldError message={errorFor('place_required')} />
        </section>
      ) : null}
      <Section title="¿Cuándo?" error={errorFor('time_required') ?? errorFor('time_in_the_future')}>
        <Chips
          label="Día"
          options={[
            { value: 'today', label: 'Hoy' },
            { value: 'yesterday', label: 'Ayer' },
          ]}
          value={when.day === 'other' ? 'today' : when.day}
          onChange={when.setDay}
        />
      </Section>
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
          hint="Por si su familia quiere preguntarte algo. Solo ella lo ve."
          error={phoneError}
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
        />
      </div>
      {report.isError ? (
        <Notice tone="warning" title="No pudimos guardar tu reporte.">
          Revisa tu conexión e inténtalo de nuevo.
        </Notice>
      ) : null}
      <Button type="submit" disabled={match.isPending || report.isPending}>
        {match.isPending || report.isPending ? 'Enviando…' : 'Enviar reporte'}
      </Button>
      <p className="m-0 text-center text-sm text-muted">Sin cuenta.</p>
    </form>
  )
}
