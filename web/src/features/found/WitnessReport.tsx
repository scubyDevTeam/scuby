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
import { useI18n } from '@i18n/react'
import { getCurrentPosition } from '@platform/location'
import { Button } from '@ui/Button'
import { Chips, type Option } from '@ui/Choice'
import { PhoneField, TextArea } from '@ui/Field'
import { PickerMap } from '@ui/Map/PickerMap'
import { Notice } from '@ui/Notice'
import { LocateFixed } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { Candidates } from './Candidates'

const speciesOptions: readonly Species[] = ['dog', 'cat', 'other']

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
  const { t } = useI18n()
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
  const errorFor = messageFor(t, tried ? errors : [])
  const contactPhone =
    phone.trim() && country
      ? toE164(phone, { prefix: country.phonePrefix, mobilePattern: country.mobilePattern })
      : null
  const phoneError = phone.trim() && !contactPhone ? t('contact.phone_invalid') : null

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
        <h1 className="m-0 text-3xl font-extrabold">{t('found.witness.thanks_title')}</h1>
        <Notice tone="success" title={t('found.witness.saved_title')}>
          {t('found.witness.saved_body')}
        </Notice>
        <Button onClick={onDone}>{t('common.done')}</Button>
      </div>
    )
  }

  if (candidates) {
    return (
      <div className="mx-auto flex max-w-lg flex-col gap-5 px-5 py-8">
        <h1 className="m-0 text-3xl font-extrabold">{t('found.candidates.title')}</h1>
        <Candidates
          candidates={candidates}
          onPick={(candidate) => send(candidate.code)}
          onNone={() => send(null)}
          noneLabel={t('found.witness.none_matches')}
        />
        {report.isError ? (
          <Notice tone="warning" title={t('found.witness.save_failed')}>
            {t('common.try_again')}
          </Notice>
        ) : null}
      </div>
    )
  }

  return (
    <form onSubmit={submit} noValidate className="mx-auto flex max-w-lg flex-col gap-6 px-5 py-6">
      <h1 className="m-0 text-3xl font-extrabold">{t('found.witness.title')}</h1>
      <Section title={t('found.witness.photo')} error={errorFor('photo_required')}>
        <PhotoPicker urls={photoUrls} onChange={setPhotoUrls} />
        <p className="m-0 text-sm text-muted">{t('found.witness.photo_hint')}</p>
      </Section>
      <Section title={t('pet.species_label')} error={errorFor('species_required')}>
        <Chips
          label={t('pet.species_label')}
          options={speciesOptions.map(
            (value): Option<Species> => ({ value, label: t(`pet.species.${value}`) }),
          )}
          value={species ?? ('' as Species)}
          onChange={setSpecies}
        />
      </Section>
      {country ? (
        <section className="flex flex-col gap-2">
          <p className="m-0 text-muted">{t('map.tap_to_mark')}</p>
          <PickerMap
            styleUrl={mapStyleUrl}
            area={{ center: point ?? country.defaultCenter, radiusM: point ? 800 : 4000 }}
            showArea={false}
            value={point}
            onChange={setPoint}
            unavailable={
              <Notice tone="neutral" title={t('map.unavailable')}>
                {t('map.use_location_instead')}
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
            {t('map.use_my_location')}
          </Button>
          {point ? (
            <p className="m-0 text-sm font-semibold text-found">{t('map.point_marked')}</p>
          ) : null}
          <FieldError message={errorFor('place_required')} />
        </section>
      ) : null}
      <Section
        title={t('found.witness.when_title')}
        error={errorFor('time_required') ?? errorFor('time_in_the_future')}
      >
        <Chips
          label={t('common.day')}
          options={[
            { value: 'today', label: t('found.witness.today') },
            { value: 'yesterday', label: t('found.witness.yesterday') },
          ]}
          value={when.day === 'other' ? 'today' : when.day}
          onChange={when.setDay}
        />
      </Section>
      <TextArea
        label={t('common.note')}
        optional
        placeholder={t('found.witness.note_placeholder')}
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />
      <div className="rounded-2xl bg-brand-mist p-4">
        <PhoneField
          label={t('contact.your_whatsapp')}
          optional
          prefix={country?.phonePrefix ?? ''}
          hint={t('found.witness.phone_hint')}
          error={phoneError}
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
        />
      </div>
      {report.isError ? (
        <Notice tone="warning" title={t('found.witness.save_failed')}>
          {t('common.check_connection')}
        </Notice>
      ) : null}
      <Button type="submit" disabled={match.isPending || report.isPending}>
        {match.isPending || report.isPending ? t('found.sending') : t('found.witness.submit')}
      </Button>
      <p className="m-0 text-center text-sm text-muted">{t('contact.no_account')}</p>
    </form>
  )
}
