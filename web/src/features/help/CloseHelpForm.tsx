import { useCloseHelp } from '@api-client/help'
import type { CloseHelpReason } from '@contracts/help'
import { useI18n } from '@i18n/react'
import { Button } from '@ui/Button'
import { RadioList } from '@ui/Field'
import { Notice } from '@ui/Notice'
import { type FormEvent, useState } from 'react'

const REASONS: readonly CloseHelpReason[] = ['need_ended', 'pet_deceased']

/** «Ya no necesita ayuda» → why (07 · `resolution`). Pet and links are untouched. */
export function CloseHelpForm({ code, onDone }: { code: string; onDone: () => void }) {
  const { t } = useI18n()
  const close = useCloseHelp(code)
  const [reason, setReason] = useState<CloseHelpReason | null>(null)
  const [tried, setTried] = useState(false)

  function submit(event: FormEvent) {
    event.preventDefault()
    setTried(true)
    if (reason) close.mutate(reason, { onSuccess: onDone })
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <p className="m-0 text-muted">{t('help_forms.close.intro')}</p>
      <RadioList
        legend={t('help_forms.close.legend')}
        name="resolution"
        options={REASONS.map((value) => ({ value, label: t(`help_forms.close.reason.${value}`) }))}
        value={reason}
        onChange={setReason}
      />
      {tried && !reason ? (
        <p role="alert" className="m-0 text-sm font-semibold text-lost-deep">
          {t('help_forms.close.choose')}
        </p>
      ) : null}
      {close.isError ? (
        <Notice tone="warning" title={t('help_forms.close.failed')}>
          {t('common.check_connection')}
        </Notice>
      ) : null}
      <Button type="submit" variant="danger" disabled={close.isPending}>
        {close.isPending ? t('help_forms.close.closing') : t('help_forms.close.submit')}
      </Button>
    </form>
  )
}
