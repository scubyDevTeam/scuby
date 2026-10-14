import { useClaimOwnership } from '@api-client/found'
import { openExternal } from '@platform/navigation'
import { WhatsAppIcon } from '@ui/BrandIcons'
import { Button, buttonClass } from '@ui/Button'
import { TextArea, TextField } from '@ui/Field'
import { Notice } from '@ui/Notice'
import { type FormEvent, useState } from 'react'

/**
 * «Es mío» (docs/product/05 · ownership_claim): one screen, everything optional — proof is offered,
 * never required. The claim is created before any channel to the custodian opens.
 */
export function OwnershipClaimForm({ code, onDone }: { code: string; onDone: () => void }) {
  const claim = useClaimOwnership(code)
  const [notes, setNotes] = useState('')
  const [chip, setChip] = useState('')

  function submit(event: FormEvent) {
    event.preventDefault()
    claim.mutate(
      { evidenceNotes: notes.trim() || null, chipNumber: chip.trim() || null },
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
        <Notice tone="success" title="Le avisamos a quien lo cuida.">
          {whatsappUrl
            ? 'Escríbele por WhatsApp para ponerse de acuerdo.'
            : 'Te va a escribir por aquí cuando revise tu mensaje.'}
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
      <p className="m-0 text-muted">
        Quien lo cuida decide a quién entregarlo. Entre más pruebas des, más fácil se lo pones.
      </p>
      <TextArea
        label="Describe algo que no salga en las fotos"
        optional
        placeholder="Una cicatriz, el color del collar, si está esterilizado…"
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
      />
      <TextField
        label="Número de microchip"
        optional
        inputMode="numeric"
        value={chip}
        onChange={(event) => setChip(event.target.value)}
      />
      {claim.isError ? (
        <Notice tone="warning" title="No pudimos enviar tu mensaje.">
          Revisa tu conexión e inténtalo de nuevo.
        </Notice>
      ) : null}
      <Button type="submit" disabled={claim.isPending}>
        {claim.isPending ? 'Enviando…' : 'Avisar que es mío'}
      </Button>
    </form>
  )
}
