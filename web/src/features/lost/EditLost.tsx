import { useConfig } from '@api-client/actions'
import { useEditLost } from '@api-client/owner'
import type { LostCase } from '@contracts/case'
import { PhotoPicker } from '@features/publish/PhotoPicker'
import { AreaFields, FieldError, Section, useWhen } from '@features/publish/parts'
import { useI18n } from '@i18n/react'
import { Button } from '@ui/Button'
import { TextArea } from '@ui/Field'
import { Notice } from '@ui/Notice'
import { type FormEvent, useState } from 'react'

type Props = {
  lostCase: LostCase
  mapStyleUrl: string | undefined
  onDone: () => void
}

/**
 * «Editar aviso» (design «Aviso · editar»): the photos, the signs, and where and when it was last
 * seen. Correcting the zone never tells the neighbours again — they were told once (04). Only the
 * owner reaches it, and only while the case is active; the server decides both.
 */
export function EditLost({ lostCase, mapStyleUrl, onDone }: Props) {
  const { t } = useI18n()
  const country = useConfig().data?.countries[0]
  const edit = useEditLost(lostCase.code)
  const when = useWhen(lostCase.lastSeen.at)
  const [photoUrls, setPhotoUrls] = useState<string[]>(lostCase.pet.photoUrls)
  const [marks, setMarks] = useState(lostCase.pet.marks ?? '')
  const [center, setCenter] = useState(lostCase.lastSeen.center)
  const [radiusM, setRadiusM] = useState(lostCase.lastSeen.radiusM)
  const [tried, setTried] = useState(false)

  const noPhoto = photoUrls.length === 0
  const future = when.at !== null && when.at.getTime() > Date.now()
  const invalid = noPhoto || future || when.at === null

  function submit(event: FormEvent) {
    event.preventDefault()
    setTried(true)
    if (invalid || !when.at) return
    edit.mutate({
      photoUrls,
      marks: marks.trim() || null,
      center,
      radiusM,
      lastSeenAt: when.at,
    })
  }

  if (edit.isSuccess) {
    return (
      <div className="flex flex-col gap-4">
        <Notice tone="success" title={t('lost_forms.edit.saved_title')}>
          {t('lost_forms.edit.saved_body')}
        </Notice>
        <Button onClick={onDone}>{t('common.done')}</Button>
      </div>
    )
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <p className="m-0 text-muted">{t('lost_forms.edit.intro')}</p>
      <Section
        title={t('publish.animal.photos')}
        error={tried && noPhoto ? t('lost_forms.edit.photos_required') : null}
      >
        <PhotoPicker urls={photoUrls} onChange={setPhotoUrls} />
      </Section>
      <TextArea
        label={t('lost_forms.publish.marks')}
        optional
        placeholder={t('publish.animal.marks_placeholder')}
        value={marks}
        onChange={(event) => setMarks(event.target.value)}
      />
      {country ? (
        <AreaFields
          center={center}
          radiusM={radiusM}
          when={when}
          defaultCenter={country.defaultCenter}
          mapStyleUrl={mapStyleUrl}
          onChange={(patch) => {
            if (patch.center) setCenter(patch.center)
            if (patch.radiusM) setRadiusM(patch.radiusM)
          }}
          errorFor={(error) =>
            tried && future && error === 'time_in_the_future'
              ? t('lost_forms.edit.time_future')
              : null
          }
          whenTitle={t('lost_forms.publish.when_title')}
        />
      ) : null}
      <p className="m-0 text-sm text-muted">{t('lost_forms.edit.no_rebroadcast')}</p>
      <FieldError message={tried && when.at === null ? t('lost_forms.edit.time_future') : null} />
      {edit.isError ? <Notice tone="warning">{t('lost_forms.edit.failed')}</Notice> : null}
      <Button type="submit" disabled={edit.isPending}>
        {t(edit.isPending ? 'lost_forms.edit.saving' : 'lost_forms.edit.save')}
      </Button>
    </form>
  )
}
