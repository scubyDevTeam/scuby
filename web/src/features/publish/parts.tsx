// The pieces every publish form is made of. Each takes its slice of the draft and reports changes.
import type { User } from '@contracts/session'
import type { Point } from '@domain/shared/geo'
import {
  type AnimalDraft,
  type ContactDraft,
  type DraftError,
  type PetSize,
  RADIUS_OPTIONS_M,
  type Species,
} from '@domain/shared/publish'
import { CODE_LENGTH } from '@domain/shared/signin'
import { getCurrentPosition } from '@platform/location'
import { Button } from '@ui/Button'
import { Chips, MultiChips, type Option } from '@ui/Choice'
import { Checkbox, PhoneField, Switch, TextArea, TextField } from '@ui/Field'
import { PickerMap } from '@ui/Map/PickerMap'
import { Notice } from '@ui/Notice'
import { ChevronLeft, LocateFixed, Lock } from 'lucide-react'
import { type ReactNode, useState } from 'react'
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

type ErrorFor = (error: DraftError) => string | null

export function StepHeader({
  title,
  step,
  steps,
  onBack,
}: {
  title: string
  step: number
  steps: number
  onBack: () => void
}) {
  return (
    <header className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label={step === 1 ? 'Salir' : 'Paso anterior'}
          onClick={onBack}
          className="flex size-11 items-center justify-center rounded-full bg-soft"
        >
          <ChevronLeft aria-hidden="true" />
        </button>
        <h1 className="m-0 flex-1 text-2xl font-extrabold">{title}</h1>
        <span className="text-sm text-muted">
          {step} de {steps}
        </span>
      </div>
      <div className="flex gap-2" aria-hidden="true">
        {Array.from({ length: steps }, (_, index) => index + 1).map((n) => (
          <span
            key={n}
            className={`h-1.5 flex-1 rounded-full ${n <= step ? 'bg-lost' : 'bg-line'}`}
          />
        ))}
      </div>
    </header>
  )
}

export function Section({
  title,
  error,
  children,
}: {
  title: string
  error?: string | null
  children: ReactNode
}) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="m-0 text-lg font-bold">{title}</h2>
      {children}
      <FieldError message={error ?? null} />
    </section>
  )
}

export function FieldError({ message }: { message: string | null }) {
  return message ? (
    <p role="alert" className="m-0 text-sm font-semibold text-lost-deep">
      {message}
    </p>
  ) : null
}

/** Photos and traits: the fields that identify an animal, the same for every vertical. */
export function AnimalFields({
  animal,
  onChange,
  errorFor,
  marksLabel,
}: {
  animal: AnimalDraft
  onChange: (patch: Partial<AnimalDraft>) => void
  errorFor: ErrorFor
  marksLabel: string
}) {
  return (
    <>
      <Section title="Fotos" error={errorFor('photo_required')}>
        <PhotoPicker urls={animal.photoUrls} onChange={(photoUrls) => onChange({ photoUrls })} />
      </Section>
      <Section title="Especie" error={errorFor('species_required')}>
        <Chips
          label="Especie"
          options={speciesOptions}
          value={animal.species ?? ('' as Species)}
          onChange={(species) => onChange({ species })}
        />
      </Section>
      <Section title="Tamaño" error={errorFor('size_required')}>
        <Chips
          label="Tamaño"
          options={sizeOptions}
          value={animal.size ?? ('' as PetSize)}
          onChange={(size) => onChange({ size })}
        />
      </Section>
      <Section title="Colores">
        <MultiChips
          label="Colores"
          options={colorOptions}
          values={animal.colors}
          onChange={(colors) => onChange({ colors })}
        />
      </Section>
      <TextArea
        label={marksLabel}
        optional
        placeholder="Collar, manchas, cómo se comporta…"
        value={animal.marks}
        onChange={(event) => onChange({ marks: event.target.value })}
      />
    </>
  )
}

export type Day = 'today' | 'yesterday' | 'other'
const dayOptions: Option<Day>[] = [
  { value: 'today', label: 'Hoy' },
  { value: 'yesterday', label: 'Ayer' },
  { value: 'other', label: 'Otro día' },
]

const pad = (value: number) => String(value).padStart(2, '0')
const dateValue = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
const timeValue = (date: Date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`

/** The «when» of a publish form: a day chip plus an approximate time, as one Date. */
export function useWhen() {
  const [day, setDay] = useState<Day>('today')
  const [otherDate, setOtherDate] = useState('')
  const [time, setTime] = useState(() => timeValue(new Date()))
  const now = new Date()
  const base =
    day === 'today'
      ? dateValue(now)
      : day === 'yesterday'
        ? dateValue(new Date(now.getTime() - 86_400_000))
        : otherDate
  const parsed = new Date(`${base}T${time}`)
  const at = base && time && !Number.isNaN(parsed.getTime()) ? parsed : null
  return { at, day, setDay, otherDate, setOtherDate, time, setTime, maxDate: dateValue(now) }
}

/** An area — a point plus a preset radius — and when. Never a pin: nobody knows the exact spot. */
export function AreaFields({
  center,
  radiusM,
  when,
  defaultCenter,
  mapStyleUrl,
  onChange,
  errorFor,
  whenTitle,
}: {
  center: Point | null
  radiusM: number
  when: ReturnType<typeof useWhen>
  defaultCenter: Point
  mapStyleUrl: string | undefined
  onChange: (patch: { center?: Point; radiusM?: number }) => void
  errorFor: ErrorFor
  whenTitle: string
}) {
  async function useMyLocation() {
    const position = await getCurrentPosition()
    if (position) onChange({ center: position })
  }

  return (
    <>
      <section className="flex flex-col gap-2">
        <p className="m-0 text-muted">Toca más o menos dónde.</p>
        <PickerMap
          styleUrl={mapStyleUrl}
          area={{ center: center ?? defaultCenter, radiusM: center ? 800 : 4000 }}
          showArea={false}
          value={center}
          radiusM={radiusM}
          onChange={(point) => onChange({ center: point })}
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
        {center ? <p className="m-0 text-sm font-semibold text-found">Zona marcada.</p> : null}
        <FieldError message={errorFor('place_required')} />
      </section>
      <Section title="¿Qué tan seguro estás del lugar?">
        <Chips
          label="¿Qué tan seguro estás del lugar?"
          options={radiusOptions}
          value={String(radiusM)}
          onChange={(radius) => onChange({ radiusM: Number(radius) })}
        />
        <p className="m-0 flex items-center gap-2 text-sm text-muted">
          <Lock aria-hidden="true" className="size-4" />
          Los demás ven una zona, nunca tu puerta.
        </p>
      </Section>
      <Section
        title={whenTitle}
        error={errorFor('time_required') ?? errorFor('time_in_the_future')}
      >
        <Chips label="Día" options={dayOptions} value={when.day} onChange={when.setDay} />
        {when.day === 'other' ? (
          <TextField
            label="Día"
            type="date"
            max={when.maxDate}
            value={when.otherDate}
            onChange={(event) => when.setOtherDate(event.target.value)}
          />
        ) : null}
        <TextField
          label="Hora aproximada"
          type="time"
          value={when.time}
          onChange={(event) => when.setTime(event.target.value)}
        />
      </Section>
    </>
  )
}

/**
 * The phone step of docs/eng/auth.md plus the contact preferences. The verified number is shown
 * prefilled with «Cambiar»; the SMS code is asked for only when the server answered `otp`.
 */
export function ContactFields({
  user,
  draft,
  onChange,
  errorFor,
  phonePrefix,
  verifiedPhone,
  onChangePhone,
  otp,
  demoCode,
}: {
  user: User
  draft: ContactDraft
  onChange: (patch: Partial<ContactDraft>) => void
  errorFor: ErrorFor
  phonePrefix: string
  /** The account's verified number, unless the publisher asked to change it. */
  verifiedPhone: string | null
  onChangePhone: () => void
  /** Present once the server asked for the code. */
  otp: { value: string; onType: (input: string) => void; wrong: boolean } | null
  demoCode: string | undefined
}) {
  const setContact = (patch: Partial<ContactDraft['contact']>) =>
    onChange({ contact: { ...draft.contact, ...patch } })
  return (
    <>
      {verifiedPhone ? (
        <section className="flex items-center justify-between gap-3 rounded-2xl bg-brand-mist p-4">
          <div>
            <p className="m-0 text-sm text-muted">Tu celular · verificado</p>
            <p className="m-0 font-bold">{verifiedPhone}</p>
          </div>
          <Button variant="link" onClick={onChangePhone}>
            Cambiar
          </Button>
        </section>
      ) : (
        <PhoneField
          label="Tu celular"
          prefix={phonePrefix}
          hint="Los vecinos te contactarán a este número."
          error={errorFor('phone_invalid')}
          disabled={otp !== null}
          value={draft.phone}
          onChange={(event) => onChange({ phone: event.target.value })}
        />
      )}
      <Checkbox
        label="Este número tiene WhatsApp"
        checked={draft.hasWhatsapp}
        onChange={(hasWhatsapp) => onChange({ hasWhatsapp })}
      />

      {otp ? (
        <section className="flex flex-col gap-3">
          <TextField
            label="Código que te enviamos por SMS"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={CODE_LENGTH}
            className="min-h-14 w-full rounded-2xl border-2 border-field bg-surface px-4 text-center font-mono text-2xl font-bold tracking-[0.5em] aria-invalid:border-lost"
            hint="Solo la primera vez."
            error={otp.wrong ? 'Ese código no coincide. Revísalo e inténtalo de nuevo.' : null}
            value={otp.value}
            onChange={(event) => otp.onType(event.target.value)}
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
            onChange={(whatsapp) => setContact({ whatsapp })}
          />
          <Switch
            label="Correo"
            hint={`te llega a ${user.email}`}
            checked={draft.contact.email}
            onChange={(email) => setContact({ email })}
          />
          <Switch
            label="Chat dentro de la app"
            hint="tu número queda oculto"
            checked={draft.contact.inApp}
            onChange={(inApp) => setContact({ inApp })}
          />
        </div>
        <FieldError message={errorFor('contact_required') ?? errorFor('whatsapp_needs_number')} />
      </section>
    </>
  )
}
