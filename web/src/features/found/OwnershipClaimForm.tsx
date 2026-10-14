import { useClaimOwnership } from '@api-client/found'
import { useI18n } from '@i18n/react'
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
  const { t } = useI18n()
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
        <Notice tone="success" title={t('found.ownership_claim.sent_title')}>
          {whatsappUrl
            ? t('found.ownership_claim.sent_whatsapp')
            : t('found.ownership_claim.sent_in_app')}
        </Notice>
        {whatsappUrl ? (
          <a
            href={whatsappUrl}
            target="_blank"
            rel="noreferrer"
            className={buttonClass('whatsapp')}
          >
            <WhatsAppIcon />
            {t('contact.open_whatsapp')}
          </a>
        ) : null}
        <Button variant="secondary" onClick={onDone}>
          {t('common.done')}
        </Button>
      </div>
    )
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <p className="m-0 text-muted">{t('found.ownership_claim.intro')}</p>
      <TextArea
        label={t('found.ownership_claim.notes_label')}
        optional
        placeholder={t('found.ownership_claim.notes_placeholder')}
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
      />
      <TextField
        label={t('pet.microchip')}
        optional
        inputMode="numeric"
        value={chip}
        onChange={(event) => setChip(event.target.value)}
      />
      {claim.isError ? (
        <Notice tone="warning" title={t('found.ownership_claim.failed')}>
          {t('common.check_connection')}
        </Notice>
      ) : null}
      <Button type="submit" disabled={claim.isPending}>
        {claim.isPending ? t('found.sending') : t('found.ownership_claim.submit')}
      </Button>
    </form>
  )
}
