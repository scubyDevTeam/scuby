import { useResolveFound } from '@api-client/found'
import type { ResolveInput } from '@contracts/found'
import { useI18n } from '@i18n/react'
import type { TextKey } from '@i18n/translate'
import { Button } from '@ui/Button'
import { RadioList, TextField } from '@ui/Field'
import { Notice } from '@ui/Notice'
import { type FormEvent, useState } from 'react'

/** «¿Quién te ayudó?» — the found flow's own list (docs/product/05 · resolution_attribution). */
const attributions = [
  { value: 'platform_claim', label: 'found.resolve.attribution.platform_claim' },
  { value: 'platform_match', label: 'found.resolve.attribution.platform_match' },
  { value: 'platform_share', label: 'found.resolve.attribution.platform_share' },
  { value: 'offline', label: 'found.resolve.attribution.offline' },
  { value: 'unknown', label: 'common.not_sure' },
] as const satisfies readonly { value: string; label: TextKey }[]

const cancelReasons = [
  { value: 'not_a_stray', label: 'found.resolve.cancel_reason.not_a_stray' },
  { value: 'ran_off_again', label: 'found.resolve.cancel_reason.ran_off_again' },
  { value: 'duplicate', label: 'found.resolve.cancel_reason.duplicate' },
] as const satisfies readonly { value: string; label: TextKey }[]

export type Outcome = 'reunited' | 'kept' | 'transferred_to_org' | 'cancelled'

type Props = { code: string; outcome: Outcome; suggested: string | null; onDone: () => void }

/** The honourable endings of custody, each a declaration by the custodian and by nobody else. */
export function ResolveForm({ code, outcome, suggested, onDone }: Props) {
  const { t } = useI18n()
  const resolve = useResolveFound(code)
  const [choice, setChoice] = useState<string | null>(outcome === 'reunited' ? suggested : null)
  const [orgName, setOrgName] = useState('')
  const [tried, setTried] = useState(false)
  const needsChoice = outcome === 'reunited' || outcome === 'cancelled'

  function submit(event: FormEvent) {
    event.preventDefault()
    setTried(true)
    if (needsChoice && !choice) return
    const input: ResolveInput =
      outcome === 'reunited'
        ? {
            outcome,
            attribution: attributions.find((a) => a.value === choice)?.value ?? 'unknown',
          }
        : outcome === 'cancelled'
          ? { outcome, reason: cancelReasons.find((r) => r.value === choice)?.value ?? 'duplicate' }
          : outcome === 'transferred_to_org'
            ? { outcome, orgName: orgName.trim() || null }
            : { outcome }
    resolve.mutate(input, { onSuccess: onDone })
  }

  const body: Record<Outcome, { intro: TextKey | null; button: TextKey; danger?: boolean }> = {
    reunited: { intro: 'found.resolve.reunited_intro', button: 'found.resolve.reunited_button' },
    kept: { intro: 'found.resolve.kept_intro', button: 'found.actions.keep' },
    transferred_to_org: {
      intro: 'found.resolve.transferred_intro',
      button: 'found.resolve.transferred_button',
    },
    cancelled: { intro: null, button: 'found.actions.delete', danger: true },
  }
  const current = body[outcome]

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      {current.intro ? <p className="m-0 text-muted">{t(current.intro)}</p> : null}
      {outcome === 'reunited' ? (
        <RadioList
          legend={t('found.resolve.attribution_legend')}
          name="attribution"
          options={attributions.map((a) => ({ value: a.value, label: t(a.label) }))}
          value={choice}
          onChange={setChoice}
        />
      ) : null}
      {outcome === 'cancelled' ? (
        <RadioList
          legend={t('found.resolve.reason_legend')}
          name="reason"
          options={cancelReasons.map((r) => ({ value: r.value, label: t(r.label) }))}
          value={choice}
          onChange={setChoice}
        />
      ) : null}
      {outcome === 'transferred_to_org' ? (
        <TextField
          label={t('found.resolve.org_label')}
          optional
          value={orgName}
          onChange={(event) => setOrgName(event.target.value)}
        />
      ) : null}
      {tried && needsChoice && !choice ? (
        <p role="alert" className="m-0 text-sm font-semibold text-lost-deep">
          {t('found.resolve.choose_one')}
        </p>
      ) : null}
      {resolve.isError ? (
        <Notice tone="warning" title={t('common.save_failed')}>
          {t('common.check_connection')}
        </Notice>
      ) : null}
      <Button
        type="submit"
        variant={current.danger ? 'danger' : 'primary'}
        disabled={resolve.isPending}
      >
        {resolve.isPending ? t('found.resolve.saving') : t(current.button)}
      </Button>
    </form>
  )
}
