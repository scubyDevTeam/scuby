import { useConfig } from '@api-client/actions'
import { useExpressInterest } from '@api-client/adoption'
import { ApiError } from '@api-client/http'
import type { Intro } from '@contracts/adoption'
import type { User } from '@contracts/session'
import {
  channelAfterInterest,
  emptyIntro,
  type Housing,
  type IntroDraft,
  type IntroError,
  introErrors,
  whatsappWithText,
} from '@domain/adoption/interest'
import { toE164 } from '@domain/shared/phone'
import { cleanCode, isCompleteCode } from '@domain/shared/signin'
import { PhoneStep, Section } from '@features/publish/parts'
import { useI18n } from '@i18n/react'
import { openExternal } from '@platform/navigation'
import { WhatsAppIcon } from '@ui/BrandIcons'
import { Button, buttonClass } from '@ui/Button'
import { Chips } from '@ui/Choice'
import { TextArea, TextField } from '@ui/Field'
import { Notice } from '@ui/Notice'
import { ExternalLink } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { introMessage } from './copy'

type Channels = { whatsappUrl: string | null; externalUrl: string | null }

/**
 * The moment the channel opens (06 · Channel, after the row): the adopter's half of the only
 * screening a P2P hand-off has, then one button per channel the lister enabled — or the word that
 * they will write back here.
 */
export function Conversation({
  listerName,
  channels,
  text,
  onDone,
}: {
  listerName: string
  channels: Channels
  /** The intro, prefilled into WhatsApp; null when reopening an earlier conversation. */
  text: string | null
  onDone: () => void
}) {
  const { t } = useI18n()
  const channel = channelAfterInterest(channels)
  const whatsapp =
    channels.whatsappUrl &&
    (text ? whatsappWithText(channels.whatsappUrl, text) : channels.whatsappUrl)
  const body = {
    whatsapp: 'adoption_forms.interest.sent_whatsapp',
    external: 'adoption_forms.interest.sent_external',
    choose: 'adoption_forms.interest.choose',
    in_app: 'adoption_forms.interest.sent_in_app',
  } as const
  return (
    <div className="flex flex-col gap-4">
      <Notice tone="success" title={t('adoption_forms.interest.sent_title', { name: listerName })}>
        {t(body[channel])}
      </Notice>
      <Notice tone="warning">{t('adoption_forms.interest.safety')}</Notice>
      {whatsapp ? (
        <a href={whatsapp} target="_blank" rel="noreferrer" className={buttonClass('whatsapp')}>
          <WhatsAppIcon />
          {t('adoption_forms.interest.write_whatsapp')}
        </a>
      ) : null}
      {channels.externalUrl ? (
        <a
          href={channels.externalUrl}
          target="_blank"
          rel="noreferrer"
          className={buttonClass('outline')}
        >
          <ExternalLink aria-hidden="true" />
          {t('adoption_forms.interest.apply_external')}
        </a>
      ) : null}
      <Button variant="secondary" onClick={onDone}>
        {t('common.done')}
      </Button>
    </div>
  )
}

const errorKey = {
  housing_required: 'adoption_forms.interest.errors.housing_required',
  yard_required: 'adoption_forms.interest.errors.yard_required',
  why_required: 'adoption_forms.interest.errors.why_required',
} as const

type Props = {
  code: string
  petName: string
  listerName: string
  /** The listing's short link, so the lister knows which animal the message is about. */
  link: string
  user: User
  demoCode: string | undefined
  onDone: () => void
}

/**
 * «Me interesa» (06 · adoption_interest): one screen before the channel — four fields and a
 * free-text «¿por qué?» — then the phone step if the account has no verified number. The row is
 * created first; only its answer opens the channel.
 */
export function InterestForm({ code, petName, listerName, link, user, demoCode, onDone }: Props) {
  const i18n = useI18n()
  const { t } = i18n
  const country = useConfig().data?.countries[0]
  const send = useExpressInterest(code)
  const [draft, setDraft] = useState<IntroDraft>(emptyIntro)
  const [phone, setPhone] = useState('')
  const [hasWhatsapp, setHasWhatsapp] = useState(true)
  const [changingPhone, setChangingPhone] = useState(false)
  const [otp, setOtp] = useState('')
  const [tried, setTried] = useState(false)

  const set = (patch: Partial<IntroDraft>) => setDraft((current) => ({ ...current, ...patch }))
  const phoneRules = country
    ? { prefix: country.phonePrefix, mobilePattern: country.mobilePattern }
    : null
  const verifiedPhone = changingPhone ? null : user.phone
  const e164 = verifiedPhone ? null : phoneRules ? toE164(phone, phoneRules) : null
  const errors = introErrors(draft)
  const phoneInvalid = !verifiedPhone && !e164
  const shown = (error: IntroError) => (tried && errors.includes(error) ? t(errorKey[error]) : null)
  const askingCode = send.data?.kind === 'otp'
  const intro: Intro | null =
    draft.housing && draft.hasYard !== null
      ? {
          housing: draft.housing,
          hasYard: draft.hasYard,
          otherPets: draft.otherPets.trim() || null,
          household: draft.household.trim() || null,
          why: draft.why.trim(),
        }
      : null
  const text = intro ? introMessage(i18n, petName, link, intro) : null

  function go(otpCode: string | null) {
    if (!intro) return
    send.mutate(
      { intro, phone: e164, hasWhatsapp, otpCode },
      {
        onSuccess: (result) => {
          if (result.kind !== 'sent') return
          // One channel only: straight there, no extra tap.
          const channel = channelAfterInterest(result)
          if (channel === 'whatsapp' && result.whatsappUrl && text) {
            openExternal(whatsappWithText(result.whatsappUrl, text))
          }
          if (channel === 'external' && result.externalUrl) openExternal(result.externalUrl)
        },
      },
    )
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    setTried(true)
    if (errors.length > 0 || phoneInvalid) return
    go(askingCode && isCompleteCode(otp) ? otp : null)
  }

  function typeOtp(input: string) {
    const typed = cleanCode(input)
    setOtp(typed)
    if (isCompleteCode(typed)) go(typed)
  }

  if (send.data?.kind === 'sent') {
    return <Conversation listerName={listerName} channels={send.data} text={text} onDone={onDone} />
  }

  const wrongCode = send.error instanceof ApiError && send.error.kind === 'rejected' && askingCode
  const yes = t('adoption_forms.interest.yard.yes')
  const no = t('adoption_forms.interest.yard.no')

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <p className="m-0 text-muted">{t('adoption_forms.interest.intro')}</p>
      <Section
        title={t('adoption_forms.interest.housing_legend')}
        error={shown('housing_required')}
      >
        <Chips
          label={t('adoption_forms.interest.housing_legend')}
          options={(['house', 'apartment'] as const).map((value) => ({
            value,
            label: t(`adoption_forms.interest.housing.${value}`),
          }))}
          value={draft.housing ?? ('' as Housing)}
          onChange={(housing) => set({ housing })}
        />
      </Section>
      <Section title={t('adoption_forms.interest.yard_legend')} error={shown('yard_required')}>
        <Chips
          label={t('adoption_forms.interest.yard_legend')}
          options={[
            { value: 'yes', label: yes },
            { value: 'no', label: no },
          ]}
          value={draft.hasYard === null ? '' : draft.hasYard ? 'yes' : 'no'}
          onChange={(answer) => set({ hasYard: answer === 'yes' })}
        />
      </Section>
      <TextField
        label={t('adoption_forms.interest.other_pets_label')}
        optional
        placeholder={t('adoption_forms.interest.other_pets_placeholder')}
        value={draft.otherPets}
        onChange={(event) => set({ otherPets: event.target.value })}
      />
      <TextField
        label={t('adoption_forms.interest.household_label')}
        optional
        placeholder={t('adoption_forms.interest.household_placeholder')}
        value={draft.household}
        onChange={(event) => set({ household: event.target.value })}
      />
      <TextArea
        label={t('adoption_forms.interest.why_label', { name: petName })}
        error={shown('why_required')}
        value={draft.why}
        onChange={(event) => set({ why: event.target.value })}
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
        phoneHint={t('adoption_forms.interest.phone_hint')}
        verifiedPhone={verifiedPhone}
        onChangePhone={() => setChangingPhone(true)}
        otp={askingCode ? { value: otp, onType: typeOtp, wrong: wrongCode } : null}
        demoCode={demoCode}
      />
      {send.isError && !wrongCode ? (
        <Notice tone="warning" title={t('adoption_forms.interest.failed')}>
          {t('common.check_connection')}
        </Notice>
      ) : null}
      <Button type="submit" disabled={send.isPending}>
        {send.isPending
          ? t('adoption_forms.interest.sending')
          : askingCode
            ? t('adoption_forms.interest.confirm_code')
            : t('adoption_forms.interest.submit')}
      </Button>
    </form>
  )
}
