import { useClaimRecovery, useConfig } from '@api-client/actions'
import { toE164 } from '@domain/shared/phone'
import { openExternal } from '@platform/navigation'
import { WhatsAppIcon } from '@ui/BrandIcons'
import { Button, buttonClass } from '@ui/Button'
import { PhoneField } from '@ui/Field'
import { Notice } from '@ui/Notice'
import { type FormEvent, useState } from 'react'

type Props = {
  code: string
  petName: string
  onDone: () => void
  /** «Solo la vi, no la tengo» — the way out to a sighting. */
  onOnlySaw: () => void
}

/**
 * «La tengo conmigo» (docs/product/04 · recovery_claim): the claim is created first, and only then
 * does the channel to the family open — never a bare WhatsApp link.
 */
export function ClaimForm({ code, petName, onDone, onOnlySaw }: Props) {
  const country = useConfig().data?.countries[0]
  const claim = useClaimRecovery(code)
  const [phone, setPhone] = useState('')
  const [tried, setTried] = useState(false)

  const e164 = country
    ? toE164(phone, { prefix: country.phonePrefix, mobilePattern: country.mobilePattern })
    : null
  const phoneError =
    !tried || e164
      ? null
      : phone.trim()
        ? 'Revisa el número de celular'
        : 'Escribe tu número de celular'

  function submit(event: FormEvent) {
    event.preventDefault()
    setTried(true)
    if (!e164) return
    claim.mutate(
      { phone: e164 },
      {
        onSuccess: (result) => {
          if (result.whatsappUrl) openExternal(result.whatsappUrl)
        },
      },
    )
  }

  if (claim.isSuccess) {
    const { whatsappUrl } = claim.data
    return (
      <div className="flex flex-col gap-4">
        <Notice tone="success" title="Ya le avisamos a su familia.">
          {whatsappUrl
            ? 'Escríbeles por WhatsApp para ponerse de acuerdo.'
            : 'Te van a contactar al número que dejaste.'}
        </Notice>
        {whatsappUrl ? (
          <a
            href={whatsappUrl}
            target="_blank"
            rel="noreferrer"
            className={buttonClass('whatsapp')}
          >
            <WhatsAppIcon />
            Abrir WhatsApp
          </a>
        ) : null}
        <Button variant="secondary" onClick={onDone}>
          Listo
        </Button>
      </div>
    )
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <p className="m-0 text-muted">Déjanos tu número y te abrimos WhatsApp con su familia.</p>
      <PhoneField
        label="Tu celular"
        prefix={country?.phonePrefix ?? ''}
        hint="Obligatorio. No te enviamos códigos ni lo publicamos."
        error={phoneError}
        value={phone}
        onChange={(event) => setPhone(event.target.value)}
      />
      <Notice>Mantenla en un lugar cerrado y con agua. Entrégala en un sitio público.</Notice>
      {claim.isError ? (
        <Notice tone="warning" title="No pudimos avisar a su familia.">
          Revisa tu conexión e inténtalo de nuevo.
        </Notice>
      ) : null}
      <Button type="submit" variant="whatsapp" disabled={claim.isPending}>
        <WhatsAppIcon />
        {claim.isPending ? 'Avisando…' : 'Avisar y abrir WhatsApp'}
      </Button>
      <Button variant="link" className="self-center" onClick={onOnlySaw}>
        Solo la vi, no la tengo
      </Button>
      <p className="sr-only">Sobre {petName}</p>
    </form>
  )
}
