import { useConfig } from '@api-client/actions'
import { ApiError } from '@api-client/http'
import { useCorrectSighting } from '@api-client/sighting-edit'
import { isWaiting } from '@api-client/sighting-queue'
import { sightingSend, useReportSighting } from '@api-client/sighting-replay'
import type { Sighting } from '@contracts/case'
import { validateSighting } from '@domain/lost/sightings'
import type { Area, Point } from '@domain/shared/geo'
import { toE164 } from '@domain/shared/phone'
import { durations } from '@domain/shared/time'
import { useI18n } from '@i18n/react'
import type { TextKey } from '@i18n/translate'
import { getCurrentPosition } from '@platform/location'
import { Button } from '@ui/Button'
import { Chips, type Option } from '@ui/Choice'
import { PhoneField, TextArea, TextField } from '@ui/Field'
import { PickerMap } from '@ui/Map/PickerMap'
import { Notice } from '@ui/Notice'
import { Clock, LocateFixed, WifiOff } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { sightingErrorCopy } from './copy'
import { QueuedCard } from './QueuedSightings'
import { useOnline, useSightingQueue } from './sighting-queue'

type When = 'now' | 'earlier' | 'yesterday' | 'custom'

const WHEN: readonly When[] = ['now', 'earlier', 'yesterday', 'custom']
const whenLabel: Record<When, TextKey> = {
  now: 'lost_forms.sighting_form.when.now',
  earlier: 'lost_forms.sighting_form.when.earlier',
  yesterday: 'lost_forms.sighting_form.when.yesterday',
  custom: 'lost_forms.sighting_form.when.custom',
}

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
  /** The pin being corrected: the form opens on it and nothing new is created. */
  correcting?: Sighting | null
  /** The reporter's own latest pin still inside its window: a second one asks about it first. */
  ownPin?: Sighting | null
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
  correcting = null,
  ownPin = null,
}: Props) {
  const i18n = useI18n()
  const { t } = i18n
  const country = useConfig().data?.countries[0]
  useSightingQueue()
  const report = useReportSighting(code)
  const correct = useCorrectSighting(code)
  const online = useOnline()
  const [point, setPoint] = useState<Point | null>(correcting?.point ?? null)
  const [when, setWhen] = useState<When>(correcting ? 'custom' : 'now')
  const [custom, setCustom] = useState(correcting ? toLocalInput(correcting.seenAt) : '')
  const [note, setNote] = useState(correcting?.note ?? '')
  const [asking, setAsking] = useState(false)
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
      ? t('lost_forms.sighting_form.place_required', { name: petName })
      : null
    : ruleErrors.includes('too_far')
      ? sightingErrorCopy(i18n, 'too_far', petName)
      : null
  const timeRule = ruleErrors.find((error) => error !== 'too_far')
  const timeError = !seenAt
    ? tried
      ? t('lost_forms.sighting_form.time_required')
      : null
    : timeRule
      ? sightingErrorCopy(i18n, timeRule, petName)
      : null
  const contactPhone = phone.trim() && country ? toE164(phone, toRules(country)) : null
  const phoneError = phone.trim() && !contactPhone ? t('contact.phone_invalid') : null

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
    if (correcting) return moveTo(correcting.id)
    // A second pin from the same reporter: ask, never guess (04 · Second pin).
    if (ownPin && !asking) return setAsking(true)
    sendNew()
  }

  function sendNew() {
    if (!point || !seenAt) return
    report.mutate(sightingSend(code, { point, seenAt, note: note.trim() || null, contactPhone }))
  }

  function moveTo(id: string) {
    if (!point || !seenAt) return
    correct.mutate({ id, point, seenAt, note: note.trim() || null })
  }

  if (correct.isSuccess) {
    return (
      <div className="flex flex-col gap-4">
        <Notice tone="success" title={t('lost_forms.sighting_form.corrected_title')}>
          {t('lost_forms.sighting_form.corrected_body')}
        </Notice>
        <Button onClick={onDone}>{t('common.done')}</Button>
      </div>
    )
  }

  if (asking && ownPin && report.isIdle && !correct.isPending) {
    return (
      <div className="flex flex-col gap-4">
        <h3 className="m-0 text-2xl font-extrabold">{t('lost_forms.sighting_form.ask_title')}</h3>
        {correct.isError ? (
          <Notice tone="warning">{t('lost_forms.sighting_form.correct_failed')}</Notice>
        ) : null}
        <Button onClick={sendNew}>{t('lost_forms.sighting_form.ask_again')}</Button>
        <Button variant="outline" onClick={() => moveTo(ownPin.id)}>
          {t('lost_forms.sighting_form.ask_correct')}
        </Button>
      </div>
    )
  }

  if (report.isSuccess) {
    return (
      <div className="flex flex-col gap-4">
        <Notice tone="success" title={t('lost_forms.sighting_form.thanks_title')}>
          {t('lost_forms.sighting_form.thanks_body')}
        </Notice>
        <Button onClick={onDone}>{t('common.done')}</Button>
      </div>
    )
  }

  // No signal (or no answer): calm, not an error. It goes by itself (docs/eng/frontend.md · Risks §6).
  if (isWaiting(report) && report.variables) {
    const { body } = report.variables
    return (
      <div className="flex flex-col gap-5">
        {online ? null : (
          <p
            role="status"
            className="m-0 flex items-center gap-2 rounded-2xl bg-brand px-4 py-3 font-bold text-white"
          >
            <WifiOff aria-hidden="true" />
            {t('lost_forms.sighting_form.offline')}
          </p>
        )}
        <span className="flex size-16 items-center justify-center rounded-3xl bg-brand-ice text-brand-deep">
          <Clock aria-hidden="true" className="size-8" />
        </span>
        <div className="flex flex-col gap-2">
          <h3 className="m-0 text-3xl font-extrabold">
            {t('lost_forms.sighting_form.queued_title')}
          </h3>
          <p className="m-0 text-muted">{t('lost_forms.sighting_form.queued_body')}</p>
        </div>
        <QueuedCard
          sighting={{ id: 0, seenAt: body.seen_at, note: body.note, rejected: null }}
          petName={petName}
          now={now}
        />
        <Button onClick={onDone}>
          {t('lost_forms.sighting_form.back_to_case', { name: petName })}
        </Button>
      </div>
    )
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      {correcting ? (
        <p className="m-0 text-muted">{t('lost_forms.sighting_form.correcting_intro')}</p>
      ) : null}
      <section className="flex flex-col gap-2">
        <p className="m-0 text-muted">{t('map.tap_to_mark')}</p>
        <PickerMap
          styleUrl={mapStyleUrl}
          area={area}
          value={point}
          onChange={setPoint}
          unavailable={
            <Notice tone="neutral" title={t('map.unavailable')}>
              {t('map.use_location_instead')}
            </Notice>
          }
        />
        <Button variant="secondary" onClick={useMyLocation} disabled={locating === 'asking'}>
          <LocateFixed aria-hidden="true" />
          {t(locating === 'asking' ? 'map.locating' : 'map.use_my_location')}
        </Button>
        {locating === 'failed' ? (
          <p className="m-0 text-sm text-muted">{t('map.location_failed')}</p>
        ) : null}
        {point && !placeError ? (
          <p className="m-0 text-sm font-semibold text-found">{t('map.point_marked')}</p>
        ) : null}
        {placeError ? (
          <p role="alert" className="m-0 text-sm font-semibold text-lost-deep">
            {placeError}
          </p>
        ) : null}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="m-0 text-lg font-bold">{t('lost_forms.sighting_form.when_title')}</h3>
        <Chips
          label={t('lost_forms.sighting_form.when_label')}
          options={WHEN.map((value): Option<When> => ({ value, label: t(whenLabel[value]) }))}
          value={when}
          onChange={setWhen}
        />
        {when === 'custom' ? (
          <TextField
            label={t('lost_forms.sighting_form.day_and_time')}
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
        label={t('common.note')}
        optional
        placeholder={t('lost_forms.sighting_form.note_placeholder')}
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />

      {correcting ? null : (
        <div className="rounded-2xl bg-brand-mist p-4">
          <PhoneField
            label={t('contact.your_whatsapp')}
            optional
            prefix={country?.phonePrefix ?? ''}
            hint={t('lost_forms.sighting_form.phone_hint')}
            error={phoneError}
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
          />
        </div>
      )}

      {correct.isError ? (
        <Notice tone="warning">{t('lost_forms.sighting_form.correct_failed')}</Notice>
      ) : null}
      {report.isError ? (
        <Notice tone="warning" title={t('lost_forms.sighting_form.failed_title')}>
          {t(
            report.error instanceof ApiError && report.error.kind === 'rejected'
              ? 'lost.queued.too_soon'
              : 'common.check_connection',
          )}
        </Notice>
      ) : null}

      <Button type="submit" disabled={report.isPending || correct.isPending}>
        {t(
          correcting
            ? correct.isPending
              ? 'lost_forms.sighting_form.correcting'
              : 'lost_forms.sighting_form.correct_submit'
            : report.isPending
              ? 'lost_forms.sighting_form.sending'
              : 'lost_forms.sighting_form.submit',
        )}
      </Button>
      {correcting ? null : (
        <p className="m-0 text-center text-sm text-muted">{t('contact.no_account')}</p>
      )}
    </form>
  )
}

/** `datetime-local` wants the viewer's own clock, to the minute. */
function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const toRules = (country: { phonePrefix: string; mobilePattern: string }) => ({
  prefix: country.phonePrefix,
  mobilePattern: country.mobilePattern,
})
