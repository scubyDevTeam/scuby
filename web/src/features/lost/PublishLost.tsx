import { useConfig } from '@api-client/actions'
import { ApiError } from '@api-client/http'
import { useMyPets, usePublishLost } from '@api-client/owner'
import type { User } from '@contracts/session'
import {
  type DraftError,
  draftFromPet,
  emptyDraft,
  type LostDraft,
  type PetSize,
  RADIUS_OPTIONS_M,
  type Species,
  type Step,
  stepErrors,
} from '@domain/lost/publish'
import { toE164 } from '@domain/shared/phone'
import { CODE_LENGTH, cleanCode, isCompleteCode } from '@domain/shared/signin'
import { getCurrentPosition } from '@platform/location'
import { Button } from '@ui/Button'
import { Chips, MultiChips, type Option } from '@ui/Choice'
import { Checkbox, PhoneField, Switch, TextArea, TextField } from '@ui/Field'
import { PickerMap } from '@ui/Map/PickerMap'
import { Notice } from '@ui/Notice'
import { ChevronLeft, LocateFixed, Lock } from 'lucide-react'
import { type FormEvent, type ReactNode, useState } from 'react'
import { PhotoPicker } from './PhotoPicker'

const speciesOptions: Option<Species>[] = [
  { value: 'dog', label: 'Perro' },
  { value: 'cat', label: 'Gato' },
  { value: 'other', label: 'Otro' },
]
const sizeOptions: Option<PetSize>[] = [
  { value: 'small', label: 'Pequeño' },
  { value: 'medium', label: 'Mediano' },
  { value: 'large', label: 'Grande' },
]
const colorOptions: Option<string>[] = [
  'Negro',
  'Blanco',
  'Café',
  'Canela',
  'Gris',
  'Amarillo',
  'Naranja',
].map((color) => ({ value: color, label: color }))
const radiusLabel: Record<number, string> = { 100: '~1 cuadra', 300: '~3 cuadras', 1000: '~1 km' }
const radiusOptions: Option<string>[] = RADIUS_OPTIONS_M.map((radius) => ({
  value: String(radius),
  label: radiusLabel[radius] ?? `${radius} m`,
}))

type Day = 'today' | 'yesterday' | 'other'
const dayOptions: Option<Day>[] = [
  { value: 'today', label: 'Hoy' },
  { value: 'yesterday', label: 'Ayer' },
  { value: 'other', label: 'Otro día' },
]

const errorCopy: Record<DraftError, string> = {
  name_required: 'Dinos cómo se llama',
  species_required: 'Elige la especie',
  size_required: 'Elige el tamaño',
  place_required: 'Toca el mapa más o menos donde se perdió',
  time_required: 'Dinos cuándo la viste por última vez',
  time_in_the_future: 'La hora no puede ser en el futuro',
  phone_invalid: 'Revisa el número de celular',
  contact_required: 'Deja al menos una forma de contacto activa',
  whatsapp_needs_number: 'Para recibir mensajes por WhatsApp, el número debe tener WhatsApp',
}

const titles: Record<Step, string> = {
  1: '¿Quién se perdió?',
  2: '¿Dónde y cuándo?',
  3: '¿Cómo te avisan?',
}

const pad = (value: number) => String(value).padStart(2, '0')
const dateValue = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
const timeValue = (date: Date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`

function lastSeen(day: Day, otherDate: string, time: string, now: Date): Date | null {
  const base =
    day === 'today'
      ? dateValue(now)
      : day === 'yesterday'
        ? dateValue(new Date(now.getTime() - 86_400_000))
        : otherDate
  const parsed = new Date(`${base}T${time}`)
  return base && time && !Number.isNaN(parsed.getTime()) ? parsed : null
}

type Props = {
  user: User
  mapStyleUrl: string | undefined
  /** Set when the backend is emulated: the SMS code it accepts. */
  demoCode: string | undefined
  /** Leaves the form (back from step 1). */
  onExit: () => void
  /** A link to a case page; the router lives in `routes`. */
  caseLink: (code: string, children: ReactNode, className: string) => ReactNode
}

/**
 * Publishing a lost case (docs/product/04 · Publishing) with the phone step of docs/eng/auth.md.
 * Whether the number needs its SMS code is the server's call: the form asks for the code only when
 * the publish answers `otp`.
 */
export function PublishLost({ user, mapStyleUrl, demoCode, onExit, caseLink }: Props) {
  const country = useConfig().data?.countries[0]
  const pets = useMyPets().data ?? []
  const publish = usePublishLost()
  const [step, setStep] = useState<Step>(1)
  const [draft, setDraft] = useState<LostDraft>(emptyDraft)
  const [day, setDay] = useState<Day>('today')
  const [otherDate, setOtherDate] = useState('')
  const [time, setTime] = useState(() => timeValue(new Date()))
  const [changingPhone, setChangingPhone] = useState(false)
  const [otp, setOtp] = useState('')
  const [tried, setTried] = useState<Step | 0>(0)

  const now = new Date()
  const set = (patch: Partial<LostDraft>) => setDraft((current) => ({ ...current, ...patch }))
  const phoneRules = country
    ? { prefix: country.phonePrefix, mobilePattern: country.mobilePattern }
    : null
  const verifiedPhone = changingPhone ? null : user.phone
  const current: LostDraft = { ...draft, lastSeenAt: lastSeen(day, otherDate, time, now) }
  const errors = stepErrors(step, current, { now, phoneRules, verifiedPhone })
  const shown = tried === step ? errors : []
  const has = (error: DraftError) => (shown.includes(error) ? errorCopy[error] : null)
  const blockedPet = pets.find((pet) => pet.id === draft.petId && pet.activeCaseCode)
  const askingCode = publish.data?.kind === 'otp'

  function send(otpCode: string | null) {
    const { species, size, center, lastSeenAt } = current
    if (!species || !size || !center || !lastSeenAt) return
    publish.mutate({
      petId: current.petId,
      name: current.name.trim(),
      species,
      size,
      colors: current.colors,
      marks: current.marks.trim() || null,
      chipNumber: current.chipNumber.trim() || null,
      photoUrls: current.photoUrls,
      center,
      radiusM: current.radiusM,
      lastSeenAt,
      phone: verifiedPhone ? null : phoneRules ? toE164(current.phone, phoneRules) : null,
      hasWhatsapp: current.hasWhatsapp,
      contact: current.contact,
      otpCode,
    })
  }

  function next(event: FormEvent) {
    event.preventDefault()
    setTried(step)
    if (errors.length > 0 || blockedPet) return
    if (step < 3) return setStep((step + 1) as Step)
    send(askingCode && isCompleteCode(otp) ? otp : null)
  }

  function typeOtp(input: string) {
    const code = cleanCode(input)
    setOtp(code)
    if (isCompleteCode(code)) send(code)
  }

  async function useMyLocation() {
    const position = await getCurrentPosition()
    if (position) set({ center: position })
  }

  if (publish.data?.kind === 'published') {
    const { code } = publish.data
    return (
      <div className="mx-auto flex max-w-lg flex-col gap-5 px-5 py-10">
        <h1 className="m-0 text-3xl font-extrabold">¡Aviso publicado!</h1>
        <Notice tone="success" title={`Ya estamos buscando a ${draft.name.trim()}.`}>
          Los vecinos de la zona pueden verlo y avisarte.
        </Notice>
        <p className="m-0 text-muted">Compártelo: entre más gente lo vea, más ojos la buscan.</p>
        {caseLink(
          code,
          'Ver mi aviso',
          'flex min-h-12 items-center justify-center rounded-2xl bg-brand px-5 font-bold text-white no-underline',
        )}
      </div>
    )
  }

  const conflict = publish.error instanceof ApiError && publish.error.kind === 'conflict'
  const wrongCode =
    publish.error instanceof ApiError && publish.error.kind === 'rejected' && askingCode

  return (
    <form onSubmit={next} noValidate className="mx-auto flex max-w-lg flex-col gap-6 px-5 py-6">
      <header className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            aria-label={step === 1 ? 'Salir' : 'Paso anterior'}
            onClick={() => (step === 1 ? onExit() : setStep((step - 1) as Step))}
            className="flex size-11 items-center justify-center rounded-full bg-soft"
          >
            <ChevronLeft aria-hidden="true" />
          </button>
          <h1 className="m-0 flex-1 text-2xl font-extrabold">{titles[step]}</h1>
          <span className="text-sm text-muted">{step} de 3</span>
        </div>
        <div className="flex gap-2" aria-hidden="true">
          {[1, 2, 3].map((n) => (
            <span
              key={n}
              className={`h-1.5 flex-1 rounded-full ${n <= step ? 'bg-lost' : 'bg-line'}`}
            />
          ))}
        </div>
      </header>

      {step === 1 ? (
        <>
          {pets.length > 0 ? (
            <section className="flex flex-col gap-2">
              <h2 className="m-0 text-lg font-bold">¿Cuál se perdió?</h2>
              <Chips
                label="¿Cuál se perdió?"
                options={[
                  ...pets.map((pet) => ({ value: pet.id, label: pet.name })),
                  { value: 'new', label: 'Otra mascota' },
                ]}
                value={draft.petId ?? 'new'}
                onChange={(id) => {
                  const pet = pets.find((p) => p.id === id)
                  setDraft(
                    pet
                      ? draftFromPet(draft, { ...pet, marks: pet.marks ?? '' })
                      : { ...emptyDraft, center: draft.center, radiusM: draft.radiusM },
                  )
                }}
              />
              {blockedPet?.activeCaseCode ? (
                <Notice tone="warning" title={`${blockedPet.name} ya tiene un aviso activo.`}>
                  {caseLink(
                    blockedPet.activeCaseCode,
                    'Ver ese aviso',
                    'font-bold text-lost-ink underline',
                  )}
                </Notice>
              ) : null}
            </section>
          ) : null}
          <TextField
            label="Nombre"
            autoComplete="off"
            error={has('name_required')}
            value={draft.name}
            onChange={(event) => set({ name: event.target.value })}
          />
          <section className="flex flex-col gap-2">
            <h2 className="m-0 text-lg font-bold">Fotos</h2>
            <PhotoPicker urls={draft.photoUrls} onChange={(photoUrls) => set({ photoUrls })} />
          </section>
          <Choice title="Especie" error={has('species_required')}>
            <Chips
              label="Especie"
              options={speciesOptions}
              value={draft.species ?? ('' as Species)}
              onChange={(species) => set({ species })}
            />
          </Choice>
          <Choice title="Tamaño" error={has('size_required')}>
            <Chips
              label="Tamaño"
              options={sizeOptions}
              value={draft.size ?? ('' as PetSize)}
              onChange={(size) => set({ size })}
            />
          </Choice>
          <Choice title="Colores" error={null}>
            <MultiChips
              label="Colores"
              options={colorOptions}
              values={draft.colors}
              onChange={(colors) => set({ colors })}
            />
          </Choice>
          <TextArea
            label="Señas para reconocerla"
            optional
            placeholder="Collar, manchas, cómo se comporta…"
            value={draft.marks}
            onChange={(event) => set({ marks: event.target.value })}
          />
          <TextField
            label="Número de microchip"
            optional
            inputMode="numeric"
            hint="Lo ven solo las veterinarias y refugios que la escaneen."
            value={draft.chipNumber}
            onChange={(event) => set({ chipNumber: event.target.value })}
          />
        </>
      ) : null}

      {step === 2 && country ? (
        <>
          <section className="flex flex-col gap-2">
            <p className="m-0 text-muted">Toca más o menos dónde.</p>
            <PickerMap
              styleUrl={mapStyleUrl}
              area={{
                center: draft.center ?? country.defaultCenter,
                radiusM: draft.center ? 800 : 4000,
              }}
              showArea={false}
              value={draft.center}
              radiusM={draft.radiusM}
              onChange={(center) => set({ center })}
              unavailable={
                <Notice tone="neutral" title="No pudimos cargar el mapa.">
                  Usa tu ubicación para marcar la zona.
                </Notice>
              }
            />
            <Button variant="secondary" onClick={useMyLocation}>
              <LocateFixed aria-hidden="true" />
              Usar mi ubicación
            </Button>
            {draft.center ? (
              <p className="m-0 text-sm font-semibold text-found">Zona marcada.</p>
            ) : null}
            <FieldError message={has('place_required')} />
          </section>
          <Choice title="¿Qué tan seguro estás del lugar?" error={null}>
            <Chips
              label="¿Qué tan seguro estás del lugar?"
              options={radiusOptions}
              value={String(draft.radiusM)}
              onChange={(radius) => set({ radiusM: Number(radius) })}
            />
            <p className="m-0 flex items-center gap-2 text-sm text-muted">
              <Lock aria-hidden="true" className="size-4" />
              Los demás ven una zona, nunca tu puerta.
            </p>
          </Choice>
          <Choice
            title="¿Cuándo la viste por última vez?"
            error={has('time_required') ?? has('time_in_the_future')}
          >
            <Chips label="Día" options={dayOptions} value={day} onChange={setDay} />
            {day === 'other' ? (
              <TextField
                label="Día"
                type="date"
                max={dateValue(now)}
                value={otherDate}
                onChange={(event) => setOtherDate(event.target.value)}
              />
            ) : null}
            <TextField
              label="Hora aproximada"
              type="time"
              value={time}
              onChange={(event) => setTime(event.target.value)}
            />
          </Choice>
        </>
      ) : null}

      {step === 3 ? (
        <>
          {verifiedPhone ? (
            <section className="flex items-center justify-between gap-3 rounded-2xl bg-brand-mist p-4">
              <div>
                <p className="m-0 text-sm text-muted">Tu celular · verificado</p>
                <p className="m-0 font-bold">{verifiedPhone}</p>
              </div>
              <Button variant="link" onClick={() => setChangingPhone(true)}>
                Cambiar
              </Button>
            </section>
          ) : (
            <PhoneField
              label="Tu celular"
              prefix={country?.phonePrefix ?? ''}
              hint="Los vecinos te contactarán a este número."
              error={has('phone_invalid')}
              disabled={askingCode}
              value={draft.phone}
              onChange={(event) => set({ phone: event.target.value })}
            />
          )}
          <Checkbox
            label="Este número tiene WhatsApp"
            checked={draft.hasWhatsapp}
            onChange={(hasWhatsapp) => set({ hasWhatsapp })}
          />

          {askingCode ? (
            <section className="flex flex-col gap-3">
              <TextField
                label="Código que te enviamos por SMS"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={CODE_LENGTH}
                className="min-h-14 w-full rounded-2xl border-2 border-field bg-surface px-4 text-center font-mono text-2xl font-bold tracking-[0.5em] aria-invalid:border-lost"
                hint="Solo la primera vez."
                error={wrongCode ? 'Ese código no coincide. Revísalo e inténtalo de nuevo.' : null}
                value={otp}
                onChange={(event) => typeOtp(event.target.value)}
              />
              {demoCode ? (
                <Notice tone="neutral" title="Modo demostración.">
                  No se envía ningún SMS: usa el código {demoCode}.
                </Notice>
              ) : null}
            </section>
          ) : null}

          <section className="flex flex-col">
            <h2 className="m-0 text-lg font-bold">¿Por dónde te pueden escribir?</h2>
            <div className="divide-y divide-line">
              <Switch
                label="WhatsApp"
                hint="se muestra tu número"
                checked={draft.contact.whatsapp}
                onChange={(whatsapp) => set({ contact: { ...draft.contact, whatsapp } })}
              />
              <Switch
                label="Correo"
                hint={`te llega a ${user.email}`}
                checked={draft.contact.email}
                onChange={(email) => set({ contact: { ...draft.contact, email } })}
              />
              <Switch
                label="Chat dentro de la app"
                hint="tu número queda oculto"
                checked={draft.contact.inApp}
                onChange={(inApp) => set({ contact: { ...draft.contact, inApp } })}
              />
            </div>
            <FieldError message={has('contact_required') ?? has('whatsapp_needs_number')} />
          </section>

          {conflict ? (
            <Notice tone="warning" title="Esta mascota ya tiene un aviso activo.">
              Revisa «Mis casos».
            </Notice>
          ) : publish.isError && !wrongCode ? (
            <Notice tone="warning" title="No pudimos publicar el aviso.">
              Revisa tu conexión e inténtalo de nuevo.
            </Notice>
          ) : null}
        </>
      ) : null}

      {step < 3 ? (
        <Button type="submit">Continuar</Button>
      ) : (
        <>
          <Button type="submit" variant="danger" disabled={publish.isPending}>
            {publish.isPending
              ? 'Publicando…'
              : askingCode
                ? 'Confirmar código y publicar'
                : 'Publicar y avisar a los vecinos'}
          </Button>
          <p className="m-0 text-center text-sm text-muted">
            Al publicar confirmas que {draft.name.trim() || 'esta'} es tu mascota.
          </p>
        </>
      )}
    </form>
  )
}

function Choice({
  title,
  error,
  children,
}: {
  title: string
  error: string | null
  children: ReactNode
}) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="m-0 text-lg font-bold">{title}</h2>
      {children}
      <FieldError message={error} />
    </section>
  )
}

function FieldError({ message }: { message: string | null }) {
  return message ? (
    <p role="alert" className="m-0 text-sm font-semibold text-lost-deep">
      {message}
    </p>
  ) : null
}
