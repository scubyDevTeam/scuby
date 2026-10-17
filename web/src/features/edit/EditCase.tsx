import { useEditCase } from '@api-client/edit'
import type { Temperament } from '@contracts/adoption'
import { TEMPERAMENTS } from '@domain/adoption/publish'
import { PhotoPicker } from '@features/publish/PhotoPicker'
import { Section } from '@features/publish/parts'
import { useI18n } from '@i18n/react'
import { Button } from '@ui/Button'
import { MultiChips } from '@ui/Choice'
import { TextArea } from '@ui/Field'
import { Notice } from '@ui/Notice'
import { type FormEvent, useState } from 'react'

export type Editable = {
  code: string
  photoUrls: string[]
  /** Found and help: the pet's signs. Absent where the vertical does not edit them. */
  marks?: string | null
  /** Adoption and help. */
  story?: string
  /** Adoption only. */
  temperament?: Temperament[]
  requirements?: string | null
}

/**
 * Correcting a found, adoption or help notice (design «Aviso · editar»; decision #27): only the
 * fields the vertical has. Never re-broadcasts. The owner and the active status are the server's call.
 */
export function EditCase({ editable, onDone }: { editable: Editable; onDone: () => void }) {
  const { t } = useI18n()
  const edit = useEditCase(editable.code)
  const [photoUrls, setPhotoUrls] = useState(editable.photoUrls)
  const [marks, setMarks] = useState(editable.marks ?? '')
  const [story, setStory] = useState(editable.story ?? '')
  const [temperament, setTemperament] = useState<Temperament[]>(editable.temperament ?? [])
  const [requirements, setRequirements] = useState(editable.requirements ?? '')
  const [tried, setTried] = useState(false)

  const noPhoto = photoUrls.length === 0
  const noStory = editable.story !== undefined && story.trim() === ''

  function submit(event: FormEvent) {
    event.preventDefault()
    setTried(true)
    if (noPhoto || noStory) return
    edit.mutate({
      photoUrls,
      ...(editable.marks !== undefined ? { marks: marks.trim() || null } : {}),
      ...(editable.story !== undefined ? { story: story.trim() } : {}),
      ...(editable.temperament !== undefined ? { temperament } : {}),
      ...(editable.requirements !== undefined ? { requirements: requirements.trim() || null } : {}),
    })
  }

  if (edit.isSuccess) {
    return (
      <div className="flex flex-col gap-4">
        <Notice tone="success" title={t('edit_case.saved_title')}>
          {t('edit_case.saved_body')}
        </Notice>
        <Button onClick={onDone}>{t('common.done')}</Button>
      </div>
    )
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <p className="m-0 text-muted">{t('edit_case.intro')}</p>
      <Section
        title={t('publish.animal.photos')}
        error={tried && noPhoto ? t('edit_case.photos_required') : null}
      >
        <PhotoPicker urls={photoUrls} onChange={setPhotoUrls} />
      </Section>
      {editable.marks !== undefined ? (
        <TextArea
          label={t('edit_case.marks')}
          optional
          value={marks}
          onChange={(event) => setMarks(event.target.value)}
        />
      ) : null}
      {editable.story !== undefined ? (
        <TextArea
          label={t('edit_case.story')}
          rows={5}
          error={tried && noStory ? t('edit_case.story_required') : null}
          value={story}
          onChange={(event) => setStory(event.target.value)}
        />
      ) : null}
      {editable.temperament !== undefined ? (
        <Section title={t('edit_case.temperament')}>
          <MultiChips
            label={t('edit_case.temperament')}
            options={TEMPERAMENTS.map((value) => ({
              value,
              label: t(`adoption.temperament.${value}`),
            }))}
            values={temperament}
            onChange={setTemperament}
          />
        </Section>
      ) : null}
      {editable.requirements !== undefined ? (
        <TextArea
          label={t('edit_case.requirements')}
          optional
          value={requirements}
          onChange={(event) => setRequirements(event.target.value)}
        />
      ) : null}
      {edit.isError ? <Notice tone="warning">{t('edit_case.failed')}</Notice> : null}
      <Button type="submit" disabled={edit.isPending}>
        {t(edit.isPending ? 'edit_case.saving' : 'edit_case.save')}
      </Button>
    </form>
  )
}
