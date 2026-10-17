// The pieces every publish form is made of. Each takes its slice of the draft and reports changes.
import type { User } from '@contracts/session'
import type { Point } from '@domain/shared/geo'
import {
  type AnimalDraft,
  type Color,
  type ContactDraft,
  type DraftError,
  type PetSize,
  RADIUS_OPTIONS_M,
  type Species,
} from '@domain/shared/publish'
import { CODE_LENGTH } from '@domain/shared/signin'
import { useI18n } from '@i18n/react'
import type { TextKey, Translator } from '@i18n/translate'
import { getCurrentPosition } from '@platform/location'
import { Button } from '@ui/Button'
import { Chips, MultiChips, type Option } from '@ui/Choice'
import { Checkbox, PhoneField, Switch, TextArea, TextField } from '@ui/Field'
import { PickerMap } from '@ui/Map/PickerMap'
import { Notice } from '@ui/Notice'
import { ChevronLeft, LocateFixed, Lock } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { PhotoPicker } from './PhotoPicker'
import { PushOffer } from './PushOffer'

const SPECIES: readonly Species[] = ['dog', 'cat', 'other']
const SIZES: readonly PetSize[] = ['small', 'medium', 'large']
const COLORS: readonly Color[] = ['black', 'white', 'brown', 'tan', 'gray', 'yellow', 'orange']
const radiusKey: Record<number, TextKey> = {
  100: 'publish.area.radius_100',
  300: 'publish.area.radius_300',
  1000: 'publish.area.radius_1000',
}
const radiusOptions = ({ t }: Translator): Option<string>[] =>
  RADIUS_OPTIONS_M.map((radius) => {
    const key = radiusKey[radius]
    return {
      value: String(radius),
      label: key ? t(key) : t('publish.area.radius_m', { radius }),
    }
  })

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
  const { t } = useI18n()
  return (
    <header className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label={t(step === 1 ? 'publish.step.exit' : 'publish.step.previous')}
          onClick={onBack}
          className="flex size-11 items-center justify-center rounded-full bg-soft"
        >
          <ChevronLeft aria-hidden="true" />
        </button>
        <h1 className="m-0 flex-1 text-2xl font-extrabold">{title}</h1>
        <span className="text-sm text-muted">{t('publish.step.count', { step, steps })}</span>
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
  const { t } = useI18n()
  return (
    <>
      <Section title={t('publish.animal.photos')} error={errorFor('photo_required')}>
        <PhotoPicker urls={animal.photoUrls} onChange={(photoUrls) => onChange({ photoUrls })} />
      </Section>
      <Section title={t('pet.species_label')} error={errorFor('species_required')}>
        <Chips
          label={t('pet.species_label')}
          options={SPECIES.map((value) => ({ value, label: t(`pet.species.${value}`) }))}
          value={animal.species ?? ('' as Species)}
          onChange={(species) => onChange({ species })}
        />
      </Section>
      <Section title={t('pet.size_label')} error={errorFor('size_required')}>
        <Chips
          label={t('pet.size_label')}
          options={SIZES.map((value) => ({ value, label: t(`pet.size.${value}`) }))}
          value={animal.size ?? ('' as PetSize)}
          onChange={(size) => onChange({ size })}
        />
      </Section>
      <Section title={t('publish.animal.colors')}>
        <MultiChips
          label={t('publish.animal.colors')}
          options={COLORS.map((value) => ({ value, label: t(`pet.colors.${value}`) }))}
          values={animal.colors}
          onChange={(colors) => onChange({ colors })}
        />
      </Section>
      <TextArea
        label={marksLabel}
        optional
        placeholder={t('publish.animal.marks_placeholder')}
        value={animal.marks}
        onChange={(event) => onChange({ marks: event.target.value })}
      />
    </>
  )
}

export type Day = 'today' | 'yesterday' | 'other'
const dayOptions = ({ t }: Translator): Option<Day>[] => [
  { value: 'today', label: t('publish.when.today') },
  { value: 'yesterday', label: t('publish.when.yesterday') },
  { value: 'other', label: t('publish.when.other_day') },
]

const pad = (value: number) => String(value).padStart(2, '0')
const dateValue = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
const timeValue = (date: Date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`

/** A moment already known — a case being edited — as the chip that says it. */
function initialDay(initial: Date | undefined): Day {
  if (!initial) return 'today'
  const now = new Date()
  if (dateValue(initial) === dateValue(now)) return 'today'
  return dateValue(initial) === dateValue(new Date(now.getTime() - 86_400_000))
    ? 'yesterday'
    : 'other'
}

/** The «when» of a publish form: a day chip plus an approximate time, as one Date. */
export function useWhen(initial?: Date) {
  const [day, setDay] = useState<Day>(() => initialDay(initial))
  const [otherDate, setOtherDate] = useState(() =>
    initial && initialDay(initial) === 'other' ? dateValue(initial) : '',
  )
  const [time, setTime] = useState(() => timeValue(initial ?? new Date()))
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
  /** Null for an area with no moment: where an adoptable animal lives now. */
  when: ReturnType<typeof useWhen> | null
  defaultCenter: Point
  mapStyleUrl: string | undefined
  onChange: (patch: { center?: Point; radiusM?: number }) => void
  errorFor: ErrorFor
  whenTitle?: string
}) {
  const i18n = useI18n()
  const { t } = i18n
  async function useMyLocation() {
    const position = await getCurrentPosition()
    if (position) onChange({ center: position })
  }

  return (
    <>
      <section className="flex flex-col gap-2">
        <p className="m-0 text-muted">{t('publish.area.tap_roughly')}</p>
        <PickerMap
          styleUrl={mapStyleUrl}
          area={{ center: center ?? defaultCenter, radiusM: center ? 800 : 4000 }}
          showArea={false}
          value={center}
          radiusM={radiusM}
          onChange={(point) => onChange({ center: point })}
          unavailable={
            <Notice tone="neutral" title={t('map.unavailable')}>
              {t('publish.area.use_location_instead')}
            </Notice>
          }
        />
        <Button variant="secondary" onClick={useMyLocation}>
          <LocateFixed aria-hidden="true" />
          {t('map.use_my_location')}
        </Button>
        {center ? (
          <p className="m-0 text-sm font-semibold text-found">{t('publish.area.marked')}</p>
        ) : null}
        <FieldError message={errorFor('place_required')} />
      </section>
      <Section title={t('publish.area.certainty')}>
        <Chips
          label={t('publish.area.certainty')}
          options={radiusOptions(i18n)}
          value={String(radiusM)}
          onChange={(radius) => onChange({ radiusM: Number(radius) })}
        />
        <p className="m-0 flex items-center gap-2 text-sm text-muted">
          <Lock aria-hidden="true" className="size-4" />
          {t('publish.area.privacy')}
        </p>
      </Section>
      {when ? (
        <Section
          title={whenTitle ?? ''}
          error={errorFor('time_required') ?? errorFor('time_in_the_future')}
        >
          <Chips
            label={t('common.day')}
            options={dayOptions(i18n)}
            value={when.day}
            onChange={when.setDay}
          />
          {when.day === 'other' ? (
            <TextField
              label={t('common.day')}
              type="date"
              max={when.maxDate}
              value={when.otherDate}
              onChange={(event) => when.setOtherDate(event.target.value)}
            />
          ) : null}
          <TextField
            label={t('publish.when.time')}
            type="time"
            value={when.time}
            onChange={(event) => when.setTime(event.target.value)}
          />
        </Section>
      ) : null}
    </>
  )
}

type Otp = { value: string; onType: (input: string) => void; wrong: boolean }

/**
 * The phone step of docs/eng/auth.md: the verified number shown prefilled with «Cambiar», or the
 * field to type one; «tiene WhatsApp» asserted by a checkbox; the SMS code asked for only when the
 * server answered `otp`. Every publish ends with it, and so does «Me interesa» (06).
 */
export function PhoneStep({
  phone,
  hasWhatsapp,
  onChange,
  error,
  phonePrefix,
  phoneHint,
  verifiedPhone,
  onChangePhone,
  otp,
  demoCode,
}: {
  phone: string
  hasWhatsapp: boolean
  onChange: (patch: { phone?: string; hasWhatsapp?: boolean }) => void
  error: string | null
  phonePrefix: string
  phoneHint: string
  /** The account's verified number, unless the person asked to change it. */
  verifiedPhone: string | null
  onChangePhone: () => void
  /** Present once the server asked for the code. */
  otp: Otp | null
  demoCode: string | undefined
}) {
  const { t } = useI18n()
  return (
    <>
      {verifiedPhone ? (
        <section className="flex items-center justify-between gap-3 rounded-2xl bg-brand-mist p-4">
          <div>
            <p className="m-0 text-sm text-muted">{t('publish.phone.verified')}</p>
            <p className="m-0 font-bold">{verifiedPhone}</p>
          </div>
          <Button variant="link" onClick={onChangePhone}>
            {t('publish.phone.change')}
          </Button>
        </section>
      ) : (
        <PhoneField
          label={t('contact.your_phone')}
          prefix={phonePrefix}
          hint={phoneHint}
          error={error}
          disabled={otp !== null}
          value={phone}
          onChange={(event) => onChange({ phone: event.target.value })}
        />
      )}
      <Checkbox
        label={t('publish.phone.has_whatsapp')}
        checked={hasWhatsapp}
        onChange={(checked) => onChange({ hasWhatsapp: checked })}
      />

      {otp ? (
        <section className="flex flex-col gap-3">
          <TextField
            label={t('publish.phone.sms_code')}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={CODE_LENGTH}
            className="min-h-14 w-full rounded-2xl border-2 border-field bg-surface px-4 text-center font-mono text-2xl font-bold tracking-[0.5em] aria-invalid:border-lost"
            hint={t('publish.phone.sms_code_hint')}
            error={otp.wrong ? t('publish.phone.wrong_code') : null}
            value={otp.value}
            onChange={(event) => otp.onType(event.target.value)}
          />
          {demoCode ? (
            <Notice tone="neutral" title={t('common.demo_mode')}>
              {t('publish.phone.demo_code', { code: demoCode })}
            </Notice>
          ) : null}
        </section>
      ) : null}
    </>
  )
}

/** The phone step plus the contact preferences: how neighbours reach the publisher. */
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
  otp: Otp | null
  demoCode: string | undefined
}) {
  const { t } = useI18n()
  const setContact = (patch: Partial<ContactDraft['contact']>) =>
    onChange({ contact: { ...draft.contact, ...patch } })
  return (
    <>
      <PhoneStep
        phone={draft.phone}
        hasWhatsapp={draft.hasWhatsapp}
        onChange={onChange}
        error={errorFor('phone_invalid')}
        phonePrefix={phonePrefix}
        phoneHint={t('publish.phone.hint')}
        verifiedPhone={verifiedPhone}
        onChangePhone={onChangePhone}
        otp={otp}
        demoCode={demoCode}
      />

      <section className="flex flex-col">
        <h2 className="m-0 text-lg font-bold">{t('publish.phone.channels')}</h2>
        <div className="divide-y divide-line">
          <Switch
            label={t('publish.phone.whatsapp')}
            hint={t('publish.phone.whatsapp_hint')}
            checked={draft.contact.whatsapp}
            onChange={(whatsapp) => setContact({ whatsapp })}
          />
          <Switch
            label={t('publish.phone.email')}
            hint={t('publish.phone.email_hint', { email: user.email })}
            checked={draft.contact.email}
            onChange={(email) => setContact({ email })}
          />
          <Switch
            label={t('publish.phone.in_app')}
            hint={t('publish.phone.in_app_hint')}
            checked={draft.contact.inApp}
            onChange={(inApp) => setContact({ inApp })}
          />
        </div>
        <FieldError message={errorFor('contact_required') ?? errorFor('whatsapp_needs_number')} />
      </section>
    </>
  )
}

/**
 * The case is live (04 / 05 · Publishing): what happened, the link to it, and — now, never on first
 * load — the offer to be notified on this phone (docs/eng/frontend.md · Push).
 */
export function Published({
  title,
  notice,
  children,
  link,
}: {
  title: string
  notice: ReactNode
  children?: ReactNode
  link: ReactNode
}) {
  return (
    <div className="mx-auto flex max-w-lg flex-col gap-5 px-5 py-10">
      <h1 className="m-0 text-3xl font-extrabold">{title}</h1>
      {notice}
      {children}
      <PushOffer />
      {link}
    </div>
  )
}
