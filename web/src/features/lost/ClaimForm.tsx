import { useClaimRecovery, useConfig } from '@api-client/actions'
import { toE164 } from '@domain/shared/phone'
import { useI18n } from '@i18n/react'
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
  const { t } = useI18n()
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
      : t(phone.trim() ? 'contact.phone_invalid' : 'lost_forms.claim_form.phone_required')

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
        <Notice tone="success" title={t('lost_forms.claim_form.sent_title')}>
          {t(whatsappUrl ? 'lost_forms.claim_form.sent_write' : 'lost_forms.claim_form.sent_wait')}
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
      <p className="m-0 text-muted">{t('lost_forms.claim_form.intro')}</p>
      <PhoneField
        label={t('contact.your_phone')}
        prefix={country?.phonePrefix ?? ''}
        hint={t('lost_forms.claim_form.phone_hint')}
        error={phoneError}
        value={phone}
        onChange={(event) => setPhone(event.target.value)}
      />
      <Notice>{t('lost_forms.claim_form.care')}</Notice>
      {claim.isError ? (
        <Notice tone="warning" title={t('lost_forms.claim_form.failed_title')}>
          {t('common.check_connection')}
        </Notice>
      ) : null}
      <Button type="submit" variant="whatsapp" disabled={claim.isPending}>
        <WhatsAppIcon />
        {t(claim.isPending ? 'lost_forms.claim_form.sending' : 'lost_forms.claim_form.submit')}
      </Button>
      <Button variant="link" className="self-center" onClick={onOnlySaw}>
        {t('lost_forms.claim_form.only_saw')}
      </Button>
      <p className="sr-only">{t('lost_forms.claim_form.about', { name: petName })}</p>
    </form>
  )
}
