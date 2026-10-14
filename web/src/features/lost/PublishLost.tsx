import { useConfig } from '@api-client/actions'
import { ApiError } from '@api-client/http'
import { useMyPets, usePublishLost } from '@api-client/owner'
import type { User } from '@contracts/session'
import {
  draftFromPet,
  emptyDraft,
  type LostDraft,
  type Step,
  stepErrors,
} from '@domain/lost/publish'
import { toE164 } from '@domain/shared/phone'
import { cleanCode, isCompleteCode } from '@domain/shared/signin'
import { messageFor } from '@features/publish/copy'
import {
  AnimalFields,
  AreaFields,
  ContactFields,
  Section,
  StepHeader,
  useWhen,
} from '@features/publish/parts'
import { Button } from '@ui/Button'
import { Chips } from '@ui/Choice'
import { TextField } from '@ui/Field'
import { Notice } from '@ui/Notice'
import { type FormEvent, type ReactNode, useState } from 'react'

const titles: Record<Step, string> = {
  1: '¿Quién se perdió?',
  2: '¿Dónde y cuándo?',
  3: '¿Cómo te avisan?',
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
  const when = useWhen()
  const [step, setStep] = useState<Step>(1)
  const [draft, setDraft] = useState<LostDraft>(emptyDraft)
  const [changingPhone, setChangingPhone] = useState(false)
  const [otp, setOtp] = useState('')
  const [tried, setTried] = useState<Step | 0>(0)

  const now = new Date()
  const set = (patch: Partial<LostDraft>) => setDraft((current) => ({ ...current, ...patch }))
  const phoneRules = country
    ? { prefix: country.phonePrefix, mobilePattern: country.mobilePattern }
    : null
  const verifiedPhone = changingPhone ? null : user.phone
  const current: LostDraft = { ...draft, lastSeenAt: when.at }
  const errors = stepErrors(step, current, { now, phoneRules, verifiedPhone })
  const errorFor = messageFor(tried === step ? errors : [])
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
      <StepHeader
        title={titles[step]}
        step={step}
        steps={3}
        onBack={() => (step === 1 ? onExit() : setStep((step - 1) as Step))}
      />

      {step === 1 ? (
        <>
          {pets.length > 0 ? (
            <Section title="¿Cuál se perdió?">
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
            </Section>
          ) : null}
          <TextField
            label="Nombre"
            autoComplete="off"
            error={errorFor('name_required')}
            value={draft.name}
            onChange={(event) => set({ name: event.target.value })}
          />
          <AnimalFields
            animal={draft}
            onChange={set}
            errorFor={errorFor}
            marksLabel="Señas para reconocerla"
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
        <AreaFields
          center={draft.center}
          radiusM={draft.radiusM}
          when={when}
          defaultCenter={country.defaultCenter}
          mapStyleUrl={mapStyleUrl}
          onChange={set}
          errorFor={errorFor}
          whenTitle="¿Cuándo la viste por última vez?"
        />
      ) : null}

      {step === 3 ? (
        <>
          <ContactFields
            user={user}
            draft={draft}
            onChange={set}
            errorFor={errorFor}
            phonePrefix={country?.phonePrefix ?? ''}
            verifiedPhone={verifiedPhone}
            onChangePhone={() => setChangingPhone(true)}
            otp={askingCode ? { value: otp, onType: typeOtp, wrong: wrongCode } : null}
            demoCode={demoCode}
          />
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
