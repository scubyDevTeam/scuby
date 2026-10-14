import { useConfig } from '@api-client/actions'
import { usePublishAdoption } from '@api-client/adoption'
import { ApiError } from '@api-client/http'
import type { FoundCase } from '@contracts/found'
import type { User } from '@contracts/session'
import {
  type AdoptionDraft,
  type AdoptionDraftError,
  type AdoptionStep,
  adoptionStepErrors,
  draftFromFound,
  emptyAdoptionDraft,
  HEALTH_FLAGS,
  type ListerRole,
  REQUIREMENT_FLAGS,
  TEMPERAMENTS,
} from '@domain/adoption/publish'
import { toE164 } from '@domain/shared/phone'
import { cleanCode, isCompleteCode } from '@domain/shared/signin'
import { formatDayMonth } from '@features/lost/copy'
import { draftErrorKey } from '@features/publish/copy'
import {
  AnimalFields,
  AreaFields,
  ContactFields,
  Published,
  Section,
  StepHeader,
} from '@features/publish/parts'
import { useI18n } from '@i18n/react'
import type { TextKey, Translator } from '@i18n/translate'
import { Button } from '@ui/Button'
import { Chips, MultiChips } from '@ui/Choice'
import { TextArea, TextField } from '@ui/Field'
import { Notice } from '@ui/Notice'
import { type FormEvent, type ReactNode, useState } from 'react'

const titles: Record<AdoptionStep, TextKey> = {
  1: 'adoption_forms.publish.title_animal',
  2: 'adoption_forms.publish.title_story',
  3: 'adoption_forms.publish.title_place',
}

const errorKey: Record<AdoptionDraftError, TextKey> = {
  ...draftErrorKey,
  role_required: 'adoption_forms.publish.errors.role_required',
  story_required: 'adoption_forms.publish.errors.story_required',
  external_url_invalid: 'adoption_forms.publish.errors.external_url_invalid',
}

/** The message for an error, only if it is among those being shown. */
const messageFor =
  (t: Translator['t'], shown: readonly AdoptionDraftError[]) => (error: AdoptionDraftError) =>
    shown.includes(error) ? t(errorKey[error]) : null

/** The found case a listing converts, pre-filling it (05 · «Publicar en adopción»). */
function initialDraft(i18n: Translator, from: FoundCase | null): AdoptionDraft {
  if (!from) return emptyAdoptionDraft
  return draftFromFound({
    pet: { ...from.pet, photoUrls: from.pet.photoUrls },
    center: from.found.center,
    radiusM: from.found.radiusM,
    story: i18n.t('adoption_forms.publish.from_found_story', {
      place: from.found.placeName,
      date: formatDayMonth(i18n, from.found.at),
    }),
  })
}

type Props = {
  user: User
  /** The custodian's found case, when this listing is its day-15 conversion. */
  fromFound: FoundCase | null
  mapStyleUrl: string | undefined
  demoCode: string | undefined
  /** The consent line with the terms and the data policy linked (docs/product/03). */
  legal: ReactNode
  onExit: () => void
  caseLink: (code: string, children: ReactNode, className: string) => ReactNode
}

/**
 * Publishing an adoption listing (docs/product/06 · `adoption_case`) with the phone step of
 * docs/eng/auth.md. Health flags go on the pet.
 */
export function PublishAdoption({
  user,
  fromFound,
  mapStyleUrl,
  demoCode,
  legal,
  onExit,
  caseLink,
}: Props) {
  const i18n = useI18n()
  const { t } = i18n
  const country = useConfig().data?.countries[0]
  const publish = usePublishAdoption()
  const [step, setStep] = useState<AdoptionStep>(1)
  const [draft, setDraft] = useState<AdoptionDraft>(() => initialDraft(i18n, fromFound))
  const [changingPhone, setChangingPhone] = useState(false)
  const [otp, setOtp] = useState('')
  const [tried, setTried] = useState<AdoptionStep | 0>(0)

  const set = (patch: Partial<AdoptionDraft>) => setDraft((current) => ({ ...current, ...patch }))
  const phoneRules = country
    ? { prefix: country.phonePrefix, mobilePattern: country.mobilePattern }
    : null
  const verifiedPhone = changingPhone ? null : user.phone
  const converting = fromFound !== null
  const errors = adoptionStepErrors(step, draft, { phoneRules, verifiedPhone, converting })
  const errorFor = messageFor(t, tried === step ? errors : [])
  const askingCode = publish.data?.kind === 'otp'

  function send(otpCode: string | null) {
    const { species, size, center } = draft
    if (!species || !size || !center) return
    publish.mutate({
      fromFoundCaseCode: fromFound?.code ?? null,
      listerRole: draft.listerRole ?? 'custodian',
      name: draft.name.trim(),
      species,
      size,
      colors: draft.colors,
      marks: draft.marks.trim() || null,
      photoUrls: draft.photoUrls,
      healthFlags: draft.healthFlags,
      story: draft.story.trim(),
      temperament: draft.temperament,
      requirementFlags: draft.requirementFlags,
      requirements: draft.requirements.trim() || null,
      center,
      radiusM: draft.radiusM,
      externalUrl: draft.externalUrl.trim() || null,
      phone: verifiedPhone ? null : phoneRules ? toE164(draft.phone, phoneRules) : null,
      hasWhatsapp: draft.hasWhatsapp,
      contact: draft.contact,
      otpCode,
    })
  }

  function next(event: FormEvent) {
    event.preventDefault()
    setTried(step)
    if (errors.length > 0) return
    if (step < 3) return setStep((step + 1) as AdoptionStep)
    send(askingCode && isCompleteCode(otp) ? otp : null)
  }

  function typeOtp(input: string) {
    const code = cleanCode(input)
    setOtp(code)
    if (isCompleteCode(code)) send(code)
  }

  if (publish.data?.kind === 'published') {
    return (
      <Published
        title={t('adoption_forms.publish.published_title')}
        notice={
          <Notice tone="success" title={t('adoption_forms.publish.published_notice_title')}>
            {t('adoption_forms.publish.published_notice_body')}
          </Notice>
        }
        link={caseLink(
          publish.data.code,
          t('adoption_forms.publish.view'),
          'flex min-h-12 items-center justify-center rounded-2xl bg-brand px-5 font-bold text-white no-underline',
        )}
      />
    )
  }

  const wrongCode =
    publish.error instanceof ApiError && publish.error.kind === 'rejected' && askingCode

  return (
    <form onSubmit={next} noValidate className="mx-auto flex max-w-lg flex-col gap-6 px-5 py-6">
      <StepHeader
        title={t(titles[step])}
        step={step}
        steps={3}
        onBack={() => (step === 1 ? onExit() : setStep((step - 1) as AdoptionStep))}
      />

      {step === 1 ? (
        <>
          {converting ? <Notice>{t('adoption_forms.publish.from_found')}</Notice> : null}
          <TextField
            label={t('adoption_forms.publish.name_label')}
            autoComplete="off"
            error={errorFor('name_required')}
            value={draft.name}
            onChange={(event) => set({ name: event.target.value })}
          />
          {converting ? null : (
            <Section
              title={t('adoption_forms.publish.role_legend')}
              error={errorFor('role_required')}
            >
              <Chips
                label={t('adoption_forms.publish.role_legend')}
                options={(['owner', 'custodian'] as const).map((value) => ({
                  value,
                  label: t(`adoption_forms.publish.role.${value}`),
                }))}
                value={draft.listerRole ?? ('' as ListerRole)}
                onChange={(listerRole) => set({ listerRole })}
              />
            </Section>
          )}
          <AnimalFields
            animal={draft}
            onChange={set}
            errorFor={errorFor}
            marksLabel={t('adoption_forms.publish.marks_label')}
          />
          <Section title={t('adoption_forms.publish.health_title')}>
            <p className="m-0 text-sm text-muted">{t('adoption_forms.publish.health_hint')}</p>
            <MultiChips
              label={t('adoption_forms.publish.health_title')}
              options={HEALTH_FLAGS.map((value) => ({
                value,
                label: t(`adoption.health.${value}`),
              }))}
              values={draft.healthFlags}
              onChange={(healthFlags) => set({ healthFlags })}
            />
          </Section>
        </>
      ) : null}

      {step === 2 ? (
        <>
          <TextArea
            label={t('adoption_forms.publish.story_label')}
            hint={t('adoption_forms.publish.story_hint')}
            error={errorFor('story_required')}
            rows={5}
            value={draft.story}
            onChange={(event) => set({ story: event.target.value })}
          />
          <Section title={t('adoption_forms.publish.temperament_title')}>
            <MultiChips
              label={t('adoption_forms.publish.temperament_title')}
              options={TEMPERAMENTS.map((value) => ({
                value,
                label: t(`adoption.temperament.${value}`),
              }))}
              values={draft.temperament}
              onChange={(temperament) => set({ temperament })}
            />
          </Section>
          <Section title={t('adoption_forms.publish.requirements_title')}>
            <MultiChips
              label={t('adoption_forms.publish.requirements_title')}
              options={REQUIREMENT_FLAGS.map((value) => ({
                value,
                label: t(`adoption.requirement.${value}`),
              }))}
              values={draft.requirementFlags}
              onChange={(requirementFlags) => set({ requirementFlags })}
            />
          </Section>
          <TextArea
            label={t('adoption_forms.publish.requirements_label')}
            optional
            value={draft.requirements}
            onChange={(event) => set({ requirements: event.target.value })}
          />
        </>
      ) : null}

      {step === 3 && country ? (
        <>
          <AreaFields
            center={draft.center}
            radiusM={draft.radiusM}
            when={null}
            defaultCenter={country.defaultCenter}
            mapStyleUrl={mapStyleUrl}
            onChange={set}
            errorFor={errorFor}
          />
          <TextField
            label={t('adoption_forms.publish.external_label')}
            optional
            type="url"
            inputMode="url"
            hint={t('adoption_forms.publish.external_hint')}
            error={errorFor('external_url_invalid')}
            value={draft.externalUrl}
            onChange={(event) => set({ externalUrl: event.target.value })}
          />
          <ContactFields
            user={user}
            draft={draft}
            onChange={set}
            errorFor={errorFor}
            phonePrefix={country.phonePrefix}
            verifiedPhone={verifiedPhone}
            onChangePhone={() => setChangingPhone(true)}
            otp={askingCode ? { value: otp, onType: typeOtp, wrong: wrongCode } : null}
            demoCode={demoCode}
          />
          <p className="m-0 text-sm text-muted">{legal}</p>
          {publish.isError && !wrongCode ? (
            <Notice tone="warning" title={t('adoption_forms.publish.publish_failed')}>
              {t('common.check_connection')}
            </Notice>
          ) : null}
        </>
      ) : null}

      {step < 3 ? (
        <Button type="submit">{t('adoption_forms.publish.continue')}</Button>
      ) : (
        <Button type="submit" disabled={publish.isPending}>
          {publish.isPending
            ? t('adoption_forms.publish.publishing')
            : askingCode
              ? t('adoption_forms.publish.confirm_code')
              : t('adoption_forms.publish.submit')}
        </Button>
      )}
    </form>
  )
}
