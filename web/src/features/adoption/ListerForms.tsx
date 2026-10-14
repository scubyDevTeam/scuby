import { useRecordAdoption, useWithdrawAdoption } from '@api-client/adoption'
import type { AdoptionCase, WithdrawReason } from '@contracts/adoption'
import { useI18n } from '@i18n/react'
import { Button } from '@ui/Button'
import { RadioList } from '@ui/Field'
import { Notice } from '@ui/Notice'
import { type FormEvent, useState } from 'react'

/** «fuera de la app»: the choice that records `adopted_offline`. */
const OFFLINE = 'offline'

/**
 * «¿Quién lo adoptó?» (06 · Record adoption): one of the people on the list — the responsibility
 * moves to them, the pet's history with it — or someone outside the app, recorded as what it is.
 */
export function RecordAdoptionForm({
  listing,
  onDone,
}: {
  listing: AdoptionCase
  onDone: () => void
}) {
  const { t } = useI18n()
  const record = useRecordAdoption(listing.code)
  const chosen = listing.interests.find((interest) => interest.status === 'chosen')
  const [choice, setChoice] = useState<string | null>(chosen?.id ?? null)
  const [tried, setTried] = useState(false)
  const people = listing.interests.filter((interest) => interest.status !== 'declined')

  function submit(event: FormEvent) {
    event.preventDefault()
    setTried(true)
    if (!choice) return
    record.mutate(choice === OFFLINE ? null : choice, { onSuccess: onDone })
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <p className="m-0 text-muted">
        {t('adoption_forms.record.intro', { name: listing.pet.name })}
      </p>
      <RadioList
        legend={t('adoption_forms.record.legend')}
        name="adopter"
        options={[
          ...people.map((interest) => ({
            value: interest.id,
            label: interest.person.displayName,
          })),
          { value: OFFLINE, label: t('adoption_forms.record.offline') },
        ]}
        value={choice}
        onChange={setChoice}
      />
      {tried && !choice ? (
        <p role="alert" className="m-0 text-sm font-semibold text-lost-deep">
          {t('adoption_forms.record.choose_one')}
        </p>
      ) : null}
      {record.isError ? (
        <Notice tone="warning" title={t('common.save_failed')}>
          {t('common.check_connection')}
        </Notice>
      ) : null}
      <Button type="submit" disabled={record.isPending}>
        {record.isPending ? t('adoption_forms.record.saving') : t('adoption_forms.record.submit')}
      </Button>
    </form>
  )
}

const REASONS: readonly WithdrawReason[] = ['kept', 'deceased', 'transferred']

/** «Ya no está disponible»: one exit with its reason — adoption has no false alarm to cancel (06). */
export function WithdrawListingForm({ code, onDone }: { code: string; onDone: () => void }) {
  const { t } = useI18n()
  const withdraw = useWithdrawAdoption(code)
  const [reason, setReason] = useState<WithdrawReason | null>(null)
  const [tried, setTried] = useState(false)

  function submit(event: FormEvent) {
    event.preventDefault()
    setTried(true)
    if (reason) withdraw.mutate(reason, { onSuccess: onDone })
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <RadioList
        legend={t('adoption_forms.withdraw.legend')}
        name="reason"
        options={REASONS.map((value) => ({
          value,
          label: t(`adoption_forms.withdraw.reasons.${value}`),
        }))}
        value={reason}
        onChange={setReason}
      />
      {tried && !reason ? (
        <p role="alert" className="m-0 text-sm font-semibold text-lost-deep">
          {t('adoption_forms.record.choose_one')}
        </p>
      ) : null}
      {withdraw.isError ? (
        <Notice tone="warning" title={t('common.save_failed')}>
          {t('common.check_connection')}
        </Notice>
      ) : null}
      <Button type="submit" variant="danger" disabled={withdraw.isPending}>
        {withdraw.isPending
          ? t('adoption_forms.record.saving')
          : t('adoption_forms.withdraw.submit')}
      </Button>
    </form>
  )
}
