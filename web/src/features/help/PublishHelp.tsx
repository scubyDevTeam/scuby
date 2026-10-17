import { useConfig } from '@api-client/actions'
import { usePublishHelp } from '@api-client/help'
import { ApiError } from '@api-client/http'
import { useMyPets } from '@api-client/owner'
import type { FoundCase } from '@contracts/found'
import type { User } from '@contracts/session'
import { MAX_NEEDS, NEED_KINDS, type NeedKind } from '@domain/help/needs'
import {
  emptyHelpDraft,
  type HelpDraft,
  type HelpDraftError,
  type HelpStep,
  helpStepErrors,
  type NeedDraft,
  newNeed,
  targetOf,
} from '@domain/help/publish'
import { toE164 } from '@domain/shared/phone'
import { cleanCode, isCompleteCode } from '@domain/shared/signin'
import { describeFound } from '@features/found/copy'
import { draftErrorKey } from '@features/publish/copy'
import { PhotoPicker } from '@features/publish/PhotoPicker'
import {
  AnimalFields,
  AreaFields,
  ContactFields,
  FieldError,
  Published,
  Section,
  StepHeader,
} from '@features/publish/parts'
import { useI18n } from '@i18n/react'
import type { TextKey, Translator } from '@i18n/translate'
import { Button } from '@ui/Button'
import { Chips } from '@ui/Choice'
import { TextArea, TextField } from '@ui/Field'
import { Notice } from '@ui/Notice'
import { Plus } from 'lucide-react'
import { type FormEvent, type ReactNode, useState } from 'react'

const titles: Record<HelpStep, TextKey> = {
  1: 'help_forms.publish.title_pet',
  2: 'help_forms.publish.title_needs',
  3: 'help_forms.publish.title_place',
}

const errorKey: Record<HelpDraftError, TextKey> = {
  ...draftErrorKey,
  needs_required: 'help_forms.publish.errors.needs_required',
  too_many_needs: 'help_forms.publish.errors.too_many_needs',
  need_detail_required: 'help_forms.publish.errors.need_detail_required',
  need_target_invalid: 'help_forms.publish.errors.need_target_invalid',
  needed_by_past: 'help_forms.publish.errors.needed_by_past',
  story_required: 'help_forms.publish.errors.story_required',
}

/** The message for an error, only if it is among those being shown. */
const messageFor =
  (t: Translator['t'], shown: readonly HelpDraftError[]) => (error: HelpDraftError) =>
    shown.includes(error) ? t(errorKey[error]) : null

/** Today, as the `YYYY-MM-DD` the date fields hold, on the device's calendar. */
function today(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

type Props = {
  user: User
  mapStyleUrl: string | undefined
  demoCode: string | undefined
  /** The consent line with the terms and the data policy linked (docs/product/03). */
  legal: ReactNode
  onExit: () => void
  caseLink: (code: string, children: ReactNode, className: string) => ReactNode
  /** `?desde=`: the found case whose animal the custodian asks for (07 · The pet). */
  fromFound?: FoundCase | null
}

/**
 * Asking for help in kind (docs/product/07 · Publishing): the pet the beneficiary holds, one to
 * three things asked — each saying exactly what — then where, the story and the phone step of
 * docs/eng/auth.md. No field takes an amount, a link or an account (decision #26).
 */
export function PublishHelp({
  user,
  mapStyleUrl,
  demoCode,
  legal,
  onExit,
  caseLink,
  fromFound = null,
}: Props) {
  const i18n = useI18n()
  const { t } = i18n
  const country = useConfig().data?.countries[0]
  const pets = useMyPets().data ?? []
  const publish = usePublishHelp()
  const [step, setStep] = useState<HelpStep>(1)
  const [draft, setDraft] = useState<HelpDraft>(() =>
    fromFound
      ? { ...emptyHelpDraft, fromCaseCode: fromFound.code, center: fromFound.found.center }
      : emptyHelpDraft,
  )
  const [changingPhone, setChangingPhone] = useState(false)
  const [otp, setOtp] = useState('')
  const [tried, setTried] = useState<HelpStep | 0>(0)

  const set = (patch: Partial<HelpDraft>) => setDraft((current) => ({ ...current, ...patch }))
  const setNeed = (index: number, patch: Partial<NeedDraft>) =>
    set({ needs: draft.needs.map((need, i) => (i === index ? { ...need, ...patch } : need)) })
  const phoneRules = country
    ? { prefix: country.phonePrefix, mobilePattern: country.mobilePattern }
    : null
  const verifiedPhone = changingPhone ? null : user.phone
  const errors = helpStepErrors(step, draft, { today: today(), phoneRules, verifiedPhone })
  const errorFor = messageFor(t, tried === step ? errors : [])
  const askingCode = publish.data?.kind === 'otp'
  const chosenPet = pets.find((pet) => pet.id === draft.petId) ?? null
  const foundTitle = fromFound ? describeFound(i18n, fromFound.pet) : null
  const petName = foundTitle ?? chosenPet?.name ?? draft.name.trim()

  function send(otpCode: string | null) {
    const { species, size, center } = draft
    if (!center || (!draft.petId && !draft.fromCaseCode && (!species || !size))) return
    publish.mutate({
      petId: draft.petId,
      fromCaseCode: draft.fromCaseCode,
      pet:
        draft.petId || draft.fromCaseCode || !species || !size
          ? null
          : {
              name: draft.name.trim(),
              species,
              size,
              colors: draft.colors,
              marks: draft.marks.trim() || null,
              photoUrls: draft.photoUrls,
            },
      needs: draft.needs.map((need) => ({
        kind: need.kind,
        detail: need.detail.trim(),
        target: targetOf(need),
        neededBy: need.neededBy || null,
      })),
      story: draft.story.trim(),
      photoUrls: draft.evidenceUrls,
      center,
      radiusM: draft.radiusM,
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
    if (step < 3) return setStep((step + 1) as HelpStep)
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
        title={t('help_forms.publish.published_title')}
        notice={
          <Notice
            tone="success"
            title={t('help_forms.publish.published_notice_title', { name: petName })}
          >
            {t('help_forms.publish.published_notice_body')}
          </Notice>
        }
        link={caseLink(
          publish.data.code,
          t('help_forms.publish.view'),
          'flex min-h-12 items-center justify-center rounded-2xl bg-brand px-5 font-bold text-white no-underline',
        )}
      />
    )
  }

  const wrongCode =
    publish.error instanceof ApiError && publish.error.kind === 'rejected' && askingCode
  const unused = NEED_KINDS.filter((kind) => !draft.needs.some((need) => need.kind === kind))

  return (
    <form onSubmit={next} noValidate className="mx-auto flex max-w-lg flex-col gap-6 px-5 py-6">
      <StepHeader
        title={t(titles[step])}
        step={step}
        steps={3}
        onBack={() => (step === 1 ? onExit() : setStep((step - 1) as HelpStep))}
      />

      {step === 1 && fromFound ? (
        <section className="flex items-center gap-3 rounded-2xl bg-brand-mist p-4">
          {fromFound.pet.photoUrls[0] ? (
            <img
              src={fromFound.pet.photoUrls[0]}
              alt=""
              className="size-16 shrink-0 rounded-2xl object-cover"
            />
          ) : null}
          <div>
            <p className="m-0 text-sm text-muted">{t('help_forms.publish.for_found')}</p>
            <p className="m-0 text-lg font-bold">{foundTitle}</p>
          </div>
        </section>
      ) : null}
      {step === 1 && !fromFound ? (
        <>
          {pets.length > 0 ? (
            <Section title={t('help_forms.publish.pet_legend')}>
              <Chips
                label={t('help_forms.publish.pet_legend')}
                options={[
                  ...pets.map((pet) => ({ value: pet.id, label: pet.name })),
                  { value: 'new', label: t('help_forms.publish.other_pet') },
                ]}
                value={draft.petId ?? 'new'}
                onChange={(id) => set({ petId: id === 'new' ? null : id })}
              />
            </Section>
          ) : null}
          {draft.petId ? null : (
            <>
              <TextField
                label={t('help_forms.publish.name_label')}
                autoComplete="off"
                error={errorFor('name_required')}
                value={draft.name}
                onChange={(event) => set({ name: event.target.value })}
              />
              <AnimalFields
                animal={draft}
                onChange={set}
                errorFor={errorFor}
                marksLabel={t('help_forms.publish.marks_label')}
              />
            </>
          )}
        </>
      ) : null}

      {step === 2 ? (
        <>
          <p className="m-0 text-muted">{t('help_forms.publish.needs_hint')}</p>
          {draft.needs.map((need, index) => (
            <section
              key={need.kind}
              aria-label={t(`help.need.kind.${need.kind}`)}
              className="flex flex-col gap-3 rounded-2xl border-2 border-help p-4"
            >
              <div className="flex items-center justify-between gap-3">
                <h2 className="m-0 text-lg font-bold">{t(`help.need.kind.${need.kind}`)}</h2>
                <Button
                  variant="link"
                  className="w-auto text-muted"
                  onClick={() => set({ needs: draft.needs.filter((_, i) => i !== index) })}
                >
                  {t('help_forms.publish.remove_need')}
                </Button>
              </div>
              <TextArea
                label={t(`help_forms.publish.detail_label.${need.kind}`)}
                placeholder={t(`help_forms.publish.detail_placeholder.${need.kind}`)}
                rows={2}
                value={need.detail}
                onChange={(event) => setNeed(index, { detail: event.target.value })}
              />
              <TextField
                label={t(`help_forms.publish.target_label.${need.kind}`)}
                optional
                inputMode="numeric"
                hint={t('help_forms.publish.target_hint')}
                value={need.target}
                onChange={(event) => setNeed(index, { target: event.target.value })}
              />
              <TextField
                label={t('help_forms.publish.needed_by_label')}
                optional
                type="date"
                min={today()}
                value={need.neededBy}
                onChange={(event) => setNeed(index, { neededBy: event.target.value })}
              />
            </section>
          ))}
          {draft.needs.length < MAX_NEEDS ? (
            <div className="flex flex-wrap gap-2">
              {unused.map((kind: NeedKind) => (
                <Button
                  key={kind}
                  variant="outline"
                  className="w-auto"
                  onClick={() => set({ needs: [...draft.needs, newNeed(kind)] })}
                >
                  <Plus aria-hidden="true" />
                  {t('help_forms.publish.add_need', { kind: t(`help.need.kind.${kind}`) })}
                </Button>
              ))}
            </div>
          ) : null}
          <FieldError
            message={
              errorFor('needs_required') ??
              errorFor('need_detail_required') ??
              errorFor('need_target_invalid') ??
              errorFor('needed_by_past')
            }
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
          <TextArea
            label={t('help_forms.publish.story_label')}
            hint={t('help_forms.publish.story_hint')}
            error={errorFor('story_required')}
            rows={5}
            value={draft.story}
            onChange={(event) => set({ story: event.target.value })}
          />
          <Section title={t('help_forms.publish.evidence_title')}>
            <p className="m-0 text-sm text-muted">{t('help_forms.publish.evidence_hint')}</p>
            <PhotoPicker
              urls={draft.evidenceUrls}
              onChange={(evidenceUrls) => set({ evidenceUrls })}
            />
          </Section>
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
          <p className="m-0 text-sm text-muted">{t('help_forms.publish.unverified_note')}</p>
          <p className="m-0 text-sm text-muted">{legal}</p>
          {publish.isError && !wrongCode ? (
            <Notice tone="warning" title={t('help_forms.publish.publish_failed')}>
              {t('common.check_connection')}
            </Notice>
          ) : null}
        </>
      ) : null}

      {step < 3 ? (
        <Button type="submit">{t('help_forms.publish.continue')}</Button>
      ) : (
        <Button type="submit" disabled={publish.isPending}>
          {publish.isPending
            ? t('help_forms.publish.publishing')
            : askingCode
              ? t('help_forms.publish.confirm_code')
              : t('help_forms.publish.submit')}
        </Button>
      )}
    </form>
  )
}
