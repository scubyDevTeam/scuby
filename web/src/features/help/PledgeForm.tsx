import { useConfig } from '@api-client/actions'
import { usePledge } from '@api-client/help'
import { ApiError } from '@api-client/http'
import type { HelpNeed } from '@contracts/help-case'
import type { User } from '@contracts/session'
import { toE164 } from '@domain/shared/phone'
import { cleanCode, isCompleteCode } from '@domain/shared/signin'
import { PhoneStep } from '@features/publish/parts'
import { useI18n } from '@i18n/react'
import { openExternal } from '@platform/navigation'
import { WhatsAppIcon } from '@ui/BrandIcons'
import { Button, buttonClass } from '@ui/Button'
import { TextArea, TextField } from '@ui/Field'
import { Notice } from '@ui/Notice'
import { type FormEvent, useState } from 'react'

/** The moment the channel opens: the safety rule, then WhatsApp or the word that they will write. */
export function PledgeSent({
  beneficiaryName,
  whatsappUrl,
  onDone,
}: {
  beneficiaryName: string
  whatsappUrl: string | null
  onDone: () => void
}) {
  const { t } = useI18n()
  return (
    <div className="flex flex-col gap-4">
      <Notice tone="success" title={t('help_forms.pledge.sent_title', { name: beneficiaryName })}>
        {t(whatsappUrl ? 'help_forms.pledge.sent_whatsapp' : 'help_forms.pledge.sent_in_app')}
      </Notice>
      <Notice tone="warning">{t('help.page.safety')}</Notice>
      {whatsappUrl ? (
        <a href={whatsappUrl} target="_blank" rel="noreferrer" className={buttonClass('whatsapp')}>
          <WhatsAppIcon />
          {t('help_forms.pledge.write_whatsapp')}
        </a>
      ) : null}
      <Button variant="secondary" onClick={onDone}>
        {t('common.done')}
      </Button>
    </div>
  )
}

/** Units only matter where a need counts more than one; a foster is one home. */
const countsUnits = (need: HelpNeed) => need.kind !== 'foster'

type Props = {
  code: string
  need: HelpNeed
  beneficiaryName: string
  user: User
  demoCode: string | undefined
  onDone: () => void
}

/**
 * «Yo ayudo» (docs/product/07 · `help_pledge`): what you offer, a note, and a reachable number —
 * a foster we cannot reach is not a foster — then the channel to the beneficiary. The row is
 * created first; only its answer opens the channel.
 */
export function PledgeForm({ code, need, beneficiaryName, user, demoCode, onDone }: Props) {
  const { t } = useI18n()
  const country = useConfig().data?.countries[0]
  const send = usePledge(code)
  const [quantity, setQuantity] = useState('1')
  const [note, setNote] = useState('')
  const [phone, setPhone] = useState('')
  const [hasWhatsapp, setHasWhatsapp] = useState(true)
  const [changingPhone, setChangingPhone] = useState(false)
  const [otp, setOtp] = useState('')
  const [tried, setTried] = useState(false)

  const phoneRules = country
    ? { prefix: country.phonePrefix, mobilePattern: country.mobilePattern }
    : null
  const verifiedPhone = changingPhone ? null : user.phone
  const e164 = verifiedPhone ? null : phoneRules ? toE164(phone, phoneRules) : null
  const phoneInvalid = !verifiedPhone && !e164
  const amount = /^[1-9]\d?$/.test(quantity.trim()) ? Number(quantity.trim()) : null
  const askingCode = send.data?.kind === 'otp'

  function go(otpCode: string | null) {
    if (amount === null) return
    send.mutate(
      {
        needId: need.id,
        quantity: amount,
        note: note.trim() || null,
        phone: e164,
        hasWhatsapp,
        otpCode,
      },
      {
        onSuccess: (result) => {
          if (result.kind === 'sent' && result.whatsappUrl) openExternal(result.whatsappUrl)
        },
      },
    )
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    setTried(true)
    if (amount === null || phoneInvalid) return
    go(askingCode && isCompleteCode(otp) ? otp : null)
  }

  function typeOtp(input: string) {
    const typed = cleanCode(input)
    setOtp(typed)
    if (isCompleteCode(typed)) go(typed)
  }

  if (send.data?.kind === 'sent') {
    return (
      <PledgeSent
        beneficiaryName={beneficiaryName}
        whatsappUrl={send.data.whatsappUrl}
        onDone={onDone}
      />
    )
  }

  const wrongCode = send.error instanceof ApiError && send.error.kind === 'rejected' && askingCode

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <p className="m-0 text-muted">{t('help_forms.pledge.intro', { name: beneficiaryName })}</p>
      <section className="flex flex-col gap-1 rounded-2xl bg-soft p-4">
        <p className="m-0 font-bold">{t(`help.need.kind.${need.kind}`)}</p>
        <p className="m-0">{need.detail}</p>
      </section>
      {countsUnits(need) ? (
        <TextField
          label={t('help_forms.pledge.quantity_label')}
          inputMode="numeric"
          error={tried && amount === null ? t('help_forms.pledge.errors.quantity_invalid') : null}
          value={quantity}
          onChange={(event) => setQuantity(event.target.value)}
        />
      ) : null}
      <TextArea
        label={t('help_forms.pledge.note_label', { name: beneficiaryName })}
        optional
        placeholder={t('help_forms.pledge.note_placeholder')}
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />
      <PhoneStep
        phone={phone}
        hasWhatsapp={hasWhatsapp}
        onChange={(patch) => {
          if (patch.phone !== undefined) setPhone(patch.phone)
          if (patch.hasWhatsapp !== undefined) setHasWhatsapp(patch.hasWhatsapp)
        }}
        error={tried && phoneInvalid ? t('contact.phone_invalid') : null}
        phonePrefix={country?.phonePrefix ?? ''}
        phoneHint={t('help_forms.pledge.phone_hint', { name: beneficiaryName })}
        verifiedPhone={verifiedPhone}
        onChangePhone={() => setChangingPhone(true)}
        otp={askingCode ? { value: otp, onType: typeOtp, wrong: wrongCode } : null}
        demoCode={demoCode}
      />
      {send.isError && !wrongCode ? (
        <Notice tone="warning" title={t('help_forms.pledge.failed')}>
          {t('common.check_connection')}
        </Notice>
      ) : null}
      <Button type="submit" disabled={send.isPending}>
        {send.isPending
          ? t('help_forms.pledge.sending')
          : askingCode
            ? t('help_forms.pledge.confirm_code')
            : t('help_forms.pledge.submit')}
      </Button>
    </form>
  )
}
