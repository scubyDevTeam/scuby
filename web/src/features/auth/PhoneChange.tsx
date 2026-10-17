import { useConfig } from '@api-client/actions'
import { ApiError } from '@api-client/http'
import { useStartPhoneChange, useVerifyPhoneChange } from '@api-client/session'
import { toE164 } from '@domain/shared/phone'
import { cleanCode, isCompleteCode } from '@domain/shared/signin'
import { useI18n } from '@i18n/react'
import { Button } from '@ui/Button'
import { PhoneField, TextField } from '@ui/Field'
import { Notice } from '@ui/Notice'
import { type FormEvent, useState } from 'react'

type Props = {
  /** Set when the backend is emulated: the SMS code it accepts. */
  demoCode: string | undefined
  onDone: () => void
  onCancel: () => void
}

/**
 * Changing (or adding) the verified phone outside a publish (docs/eng/auth.md · Profile, Phone):
 * the number, the SMS code, done. The code completes itself at six digits.
 */
export function PhoneChange({ demoCode, onDone, onCancel }: Props) {
  const { t } = useI18n()
  const country = useConfig().data?.countries[0]
  const start = useStartPhoneChange()
  const verify = useVerifyPhoneChange()
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [tried, setTried] = useState(false)
  const e164 = country
    ? toE164(phone, { prefix: country.phonePrefix, mobilePattern: country.mobilePattern })
    : null
  const sentTo = start.isSuccess ? start.variables : null

  function send(event: FormEvent) {
    event.preventDefault()
    setTried(true)
    if (!e164) return
    start.mutate(e164)
  }

  function type(input: string) {
    const typed = cleanCode(input)
    setCode(typed)
    if (sentTo && isCompleteCode(typed)) {
      verify.mutate({ phone: sentTo, code: typed }, { onSuccess: onDone })
    }
  }

  const wrong = verify.error instanceof ApiError && verify.error.kind === 'rejected'

  if (sentTo) {
    return (
      <div className="flex flex-col gap-3">
        <TextField
          label={t('auth.profile.phone_change.code_label')}
          inputMode="numeric"
          autoComplete="one-time-code"
          hint={t('auth.profile.phone_change.code_hint', { phone: sentTo })}
          error={
            wrong
              ? t('auth.profile.phone_change.wrong_code')
              : verify.isError
                ? t('auth.profile.phone_change.failed')
                : null
          }
          value={code}
          onChange={(event) => type(event.target.value)}
        />
        {demoCode ? (
          <p className="m-0 text-sm text-muted">
            {t('auth.profile.phone_change.demo', { code: demoCode })}
          </p>
        ) : null}
        <Button variant="link" className="self-start" onClick={onCancel}>
          {t('auth.profile.phone_change.cancel')}
        </Button>
      </div>
    )
  }

  return (
    <form onSubmit={send} noValidate className="flex flex-col gap-3">
      <PhoneField
        label={t('auth.profile.phone_change.label')}
        prefix={country?.phonePrefix ?? ''}
        error={tried && !e164 ? t('auth.profile.phone_change.invalid') : null}
        value={phone}
        onChange={(event) => setPhone(event.target.value)}
      />
      <p className="m-0 text-sm text-muted">{t('auth.profile.phone_change.note')}</p>
      {start.isError ? (
        <Notice tone="warning">{t('auth.profile.phone_change.failed')}</Notice>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={start.isPending}>
          {t(
            start.isPending
              ? 'auth.profile.phone_change.sending'
              : 'auth.profile.phone_change.send',
          )}
        </Button>
        <Button variant="outline" onClick={onCancel}>
          {t('auth.profile.phone_change.cancel')}
        </Button>
      </div>
    </form>
  )
}
