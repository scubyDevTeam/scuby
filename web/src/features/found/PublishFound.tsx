import { useConfig } from '@api-client/actions'
import { useMatchAnimal, usePublishFound } from '@api-client/found'
import { ApiError } from '@api-client/http'
import type { Candidate } from '@contracts/found'
import type { User } from '@contracts/session'
import {
  emptyFoundDraft,
  type FoundDraft,
  type FoundStep,
  foundStepErrors,
  type HoldingWhere,
} from '@domain/found/publish'
import { toE164 } from '@domain/shared/phone'
import { cleanCode, isCompleteCode } from '@domain/shared/signin'
import { ClaimForm } from '@features/lost/ClaimForm'
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
import { Chips, type Option } from '@ui/Choice'
import { TextField } from '@ui/Field'
import { Notice } from '@ui/Notice'
import { type FormEvent, type ReactNode, useState } from 'react'
import { Candidates } from './Candidates'

const titles: Record<FoundStep, string> = {
  1: '¿Cómo es?',
  2: '¿Dónde y cuándo lo encontraste?',
  3: '¿Cómo te avisan?',
}

const holdingOptions: Option<HoldingWhere>[] = [
  { value: 'home', label: 'En mi casa' },
  { value: 'vet', label: 'En una veterinaria' },
  { value: 'street_temporary', label: 'Sigue en la calle, lo cuido' },
]

type Props = {
  user: User
  mapStyleUrl: string | undefined
  demoCode: string | undefined
  onExit: () => void
  caseLink: (code: string, children: ReactNode, className: string) => ReactNode
}

/**
 * Publishing a found case (docs/product/05 · Publishing: match first, then create). After «where
 * and when», the animal is matched against pets being searched for: recognising one opens a
 * recovery claim on that lost case and no found case is created.
 */
export function PublishFound({ user, mapStyleUrl, demoCode, onExit, caseLink }: Props) {
  const country = useConfig().data?.countries[0]
  const match = useMatchAnimal()
  const publish = usePublishFound()
  const when = useWhen()
  const [step, setStep] = useState<FoundStep>(1)
  const [draft, setDraft] = useState<FoundDraft>(emptyFoundDraft)
  const [changingPhone, setChangingPhone] = useState(false)
  const [otp, setOtp] = useState('')
  const [tried, setTried] = useState<FoundStep | 0>(0)
  /** Candidates on screen, or the one the custodian recognised. */
  const [matching, setMatching] = useState<{
    candidates: Candidate[]
    picked: Candidate | null
  } | null>(null)

  const now = new Date()
  const set = (patch: Partial<FoundDraft>) => setDraft((current) => ({ ...current, ...patch }))
  const phoneRules = country
    ? { prefix: country.phonePrefix, mobilePattern: country.mobilePattern }
    : null
  const verifiedPhone = changingPhone ? null : user.phone
  const current: FoundDraft = { ...draft, foundAt: when.at }
  const errors = foundStepErrors(step, current, { now, phoneRules, verifiedPhone })
  const errorFor = messageFor(tried === step ? errors : [])
  const askingCode = publish.data?.kind === 'otp'

  function send(otpCode: string | null) {
    const { species, size, center, foundAt } = current
    if (!species || !size || !center || !foundAt) return
    publish.mutate({
      species,
      size,
      colors: current.colors,
      marks: current.marks.trim() || null,
      photoUrls: current.photoUrls,
      center,
      radiusM: current.radiusM,
      foundAt,
      holdingWhere: current.holdingWhere,
      withheldDetail: current.withheldDetail.trim() || null,
      phone: verifiedPhone ? null : phoneRules ? toE164(current.phone, phoneRules) : null,
      hasWhatsapp: current.hasWhatsapp,
      contact: current.contact,
      otpCode,
    })
  }

  function next(event: FormEvent) {
    event.preventDefault()
    setTried(step)
    if (errors.length > 0) return
    if (step === 1) return setStep(2)
    if (step === 2) {
      const { species, center, foundAt } = current
      if (!species || !center || !foundAt) return
      // Match before create. If matching is down, publishing must still be possible.
      return match.mutate(
        { species, size: current.size, colors: current.colors, point: center, at: foundAt },
        {
          onSuccess: (candidates) =>
            candidates.length > 0 ? setMatching({ candidates, picked: null }) : setStep(3),
          onError: () => setStep(3),
        },
      )
    }
    send(askingCode && isCompleteCode(otp) ? otp : null)
  }

  function typeOtp(input: string) {
    const code = cleanCode(input)
    setOtp(code)
    if (isCompleteCode(code)) send(code)
  }

  if (matching?.picked) {
    // The animal already has a family looking: a claim on their case, never a second card.
    return (
      <div className="mx-auto flex max-w-lg flex-col gap-5 px-5 py-8">
        <h1 className="m-0 text-3xl font-extrabold">¡Es {matching.picked.name}!</h1>
        <ClaimForm
          code={matching.picked.code}
          petName={matching.picked.name}
          onDone={onExit}
          onOnlySaw={() => setMatching({ ...matching, picked: null })}
        />
      </div>
    )
  }

  if (matching) {
    return (
      <div className="mx-auto flex max-w-lg flex-col gap-5 px-5 py-8">
        <h1 className="m-0 text-3xl font-extrabold">¿Es alguno de estos?</h1>
        <Candidates
          candidates={matching.candidates}
          onPick={(picked) => setMatching({ ...matching, picked })}
          onNone={() => {
            setMatching(null)
            setStep(3)
          }}
          noneLabel="No es ninguno, publicar mi aviso"
        />
      </div>
    )
  }

  if (publish.data?.kind === 'published') {
    return (
      <div className="mx-auto flex max-w-lg flex-col gap-5 px-5 py-10">
        <h1 className="m-0 text-3xl font-extrabold">¡Aviso publicado!</h1>
        <Notice tone="success" title="Gracias por cuidarlo.">
          Los vecinos de la zona ya pueden verlo. Si aparece su familia, te avisamos.
        </Notice>
        {caseLink(
          publish.data.code,
          'Ver mi aviso',
          'flex min-h-12 items-center justify-center rounded-2xl bg-brand px-5 font-bold text-white no-underline',
        )}
      </div>
    )
  }

  const wrongCode =
    publish.error instanceof ApiError && publish.error.kind === 'rejected' && askingCode

  return (
    <form onSubmit={next} noValidate className="mx-auto flex max-w-lg flex-col gap-6 px-5 py-6">
      <StepHeader
        title={titles[step]}
        step={step}
        steps={3}
        onBack={() => (step === 1 ? onExit() : setStep((step - 1) as FoundStep))}
      />

      {step === 1 ? (
        <>
          <AnimalFields
            animal={draft}
            onChange={set}
            errorFor={errorFor}
            marksLabel="Cómo es y cómo se porta"
          />
          <TextField
            label="Guarda un dato que solo su dueño sabría"
            optional
            hint="Algo que no se vea en las fotos: una cicatriz, el color del collar, si está esterilizado. No se publica: te sirve para saber quién es de verdad su dueño."
            value={draft.withheldDetail}
            onChange={(event) => set({ withheldDetail: event.target.value })}
          />
        </>
      ) : null}

      {step === 2 && country ? (
        <>
          <AreaFields
            center={draft.center}
            radiusM={draft.radiusM}
            when={when}
            defaultCenter={country.defaultCenter}
            mapStyleUrl={mapStyleUrl}
            onChange={set}
            errorFor={errorFor}
            whenTitle="¿Cuándo lo encontraste?"
          />
          <Section title="¿Dónde está ahora?">
            <Chips
              label="¿Dónde está ahora?"
              options={holdingOptions}
              value={draft.holdingWhere}
              onChange={(holdingWhere) => set({ holdingWhere })}
            />
            <p className="m-0 text-sm text-muted">
              Esto sí se muestra: le dice a su familia qué tan urgente es.
            </p>
          </Section>
        </>
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
          {publish.isError && !wrongCode ? (
            <Notice tone="warning" title="No pudimos publicar el aviso.">
              Revisa tu conexión e inténtalo de nuevo.
            </Notice>
          ) : null}
        </>
      ) : null}

      {step < 3 ? (
        <Button type="submit" disabled={match.isPending}>
          {match.isPending ? 'Buscando si alguien lo busca…' : 'Continuar'}
        </Button>
      ) : (
        <Button type="submit" disabled={publish.isPending}>
          {publish.isPending
            ? 'Publicando…'
            : askingCode
              ? 'Confirmar código y publicar'
              : 'Publicar y avisar a los vecinos'}
        </Button>
      )}
    </form>
  )
}
