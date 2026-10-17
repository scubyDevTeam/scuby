import { useConfig } from '@api-client/actions'
import { useNearbyAlerts, useSetNearbyAlerts } from '@api-client/alerts'
import { useRegisterPush } from '@api-client/session'
import {
  ALERT_RADII_KM,
  type AlertRadiusKm,
  alertRadiusM,
  canActivateAlerts,
  DEFAULT_ALERT_RADIUS_KM,
  isAlertRadius,
} from '@domain/shared/alerts'
import { useI18n } from '@i18n/react'
import { getCurrentPosition } from '@platform/location'
import { pushPermission, pushSupport, subscribePush } from '@platform/push'
import { Button } from '@ui/Button'
import { Chips, type Option } from '@ui/Choice'
import { PickerMap } from '@ui/Map/PickerMap'
import { Notice } from '@ui/Notice'
import { Sheet } from '@ui/Sheet'
import { Skeleton } from '@ui/States'
import { BellRing, LocateFixed } from 'lucide-react'
import { useState } from 'react'

type Point = { lat: number; lng: number }
type Step = 'permission' | 'zone' | 'done'

/**
 * «Mascotas perdidas cerca de mí» (docs/product/08; design «Alertas · activación»): the profile's
 * switch for being told about lost pets around a point. Turning it on is two taps — the phone's
 * permission, then the zone — and it works without the permission too: the alerts still land in
 * the Bandeja.
 */
export function NearbyAlerts({ mapStyleUrl }: { mapStyleUrl: string | undefined }) {
  const { t } = useI18n()
  const alerts = useNearbyAlerts()
  const set = useSetNearbyAlerts()
  const [open, setOpen] = useState(false)

  if (alerts.isPending) return <Skeleton className="h-28" />
  if (alerts.isError) {
    return <Notice tone="neutral">{t('auth.profile.alerts.load_failed')}</Notice>
  }
  const current = alerts.data

  return (
    <section className="flex flex-col gap-3 rounded-2xl bg-brand-ice p-4">
      <div className="flex gap-3">
        <BellRing aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-brand-deep" />
        <div className="flex flex-col gap-1">
          <h2 className="m-0 text-lg font-bold">{t('auth.profile.alerts.title')}</h2>
          <p className="m-0">
            {current.enabled && current.center
              ? t('auth.profile.alerts.on_summary', {
                  place: current.placeName ?? '',
                  km: current.radiusKm,
                })
              : t('auth.profile.alerts.off_hint')}
          </p>
        </div>
      </div>
      {set.isError ? (
        <p role="alert" className="m-0 text-sm font-semibold text-lost-deep">
          {t('auth.profile.alerts.off_failed')}
        </p>
      ) : null}
      {current.enabled ? (
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setOpen(true)}>
            {t('auth.profile.alerts.change_zone')}
          </Button>
          <Button
            variant="outline"
            disabled={set.isPending}
            onClick={() =>
              set.mutate({ enabled: false, center: current.center, radiusKm: current.radiusKm })
            }
          >
            {t('auth.profile.alerts.turn_off')}
          </Button>
        </div>
      ) : (
        <Button onClick={() => setOpen(true)}>{t('auth.profile.alerts.activate')}</Button>
      )}
      {open ? (
        <Setup
          initial={{ center: current.center, radiusKm: current.radiusKm }}
          mapStyleUrl={mapStyleUrl}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </section>
  )
}

function Setup({
  initial,
  mapStyleUrl,
  onClose,
}: {
  initial: { center: Point | null; radiusKm: AlertRadiusKm }
  mapStyleUrl: string | undefined
  onClose: () => void
}) {
  const { t } = useI18n()
  const country = useConfig().data?.countries[0]
  const set = useSetNearbyAlerts()
  const register = useRegisterPush()
  // The permission step is asked only when it can still change something.
  const needsPermission = pushSupport() === 'available' && pushPermission() === 'default'
  const [step, setStep] = useState<Step>(needsPermission ? 'permission' : 'zone')
  const [permission, setPermission] = useState<'idle' | 'asking' | 'denied' | 'failed'>('idle')
  const [center, setCenter] = useState<Point | null>(initial.center)
  const [radiusKm, setRadiusKm] = useState<AlertRadiusKm>(
    initial.radiusKm ?? DEFAULT_ALERT_RADIUS_KM,
  )
  const [locating, setLocating] = useState(false)
  const [tried, setTried] = useState(false)
  const stepOf = needsPermission
    ? { permission: 1, zone: 2, done: 2 }
    : { permission: 1, zone: 1, done: 1 }
  const total = needsPermission ? 2 : 1

  async function allow() {
    setPermission('asking')
    const outcome = await subscribePush()
    if (outcome === 'denied') {
      setPermission('denied')
      return
    }
    if (outcome === 'dismissed') return setPermission('idle')
    if (outcome === 'unavailable') {
      setPermission('failed')
      return
    }
    register.mutate(
      { ...outcome, device: null },
      { onSuccess: () => setStep('zone'), onError: () => setPermission('failed') },
    )
  }

  async function useMyLocation() {
    setLocating(true)
    const position = await getCurrentPosition()
    if (position) setCenter(position)
    setLocating(false)
  }

  function confirm() {
    setTried(true)
    if (!canActivateAlerts({ center })) return
    set.mutate({ enabled: true, center, radiusKm }, { onSuccess: () => setStep('done') })
  }

  const frame = center ?? country?.defaultCenter ?? { lat: 6.2442, lng: -75.5812 }
  const title =
    step === 'permission'
      ? t('auth.profile.alerts.sheet.permission_title')
      : t('auth.profile.alerts.sheet.zone_title')

  return (
    <Sheet open onClose={onClose} title={title} size={step === 'zone' ? 'full' : 'auto'}>
      {step !== 'done' ? (
        <p className="m-0 text-sm text-muted">
          {t('auth.profile.alerts.sheet.step', { n: stepOf[step], total })}
        </p>
      ) : null}

      {step === 'permission' ? (
        <div className="flex flex-col gap-4">
          <p className="m-0 text-muted">{t('auth.profile.alerts.sheet.permission_body')}</p>
          {permission === 'denied' || permission === 'failed' ? (
            <Notice tone="neutral">
              {t(
                permission === 'denied'
                  ? 'auth.profile.alerts.sheet.denied'
                  : 'auth.profile.alerts.sheet.failed',
              )}
            </Notice>
          ) : null}
          {permission === 'denied' || permission === 'failed' ? (
            <Button onClick={() => setStep('zone')}>
              {t('auth.profile.alerts.sheet.continue')}
            </Button>
          ) : (
            <>
              <Button disabled={permission === 'asking'} onClick={allow}>
                {t(
                  permission === 'asking'
                    ? 'auth.profile.alerts.sheet.enabling'
                    : 'auth.profile.alerts.sheet.allow',
                )}
              </Button>
              <Button variant="link" className="self-center" onClick={() => setStep('zone')}>
                {t('auth.profile.alerts.sheet.skip')}
              </Button>
            </>
          )}
        </div>
      ) : null}

      {step === 'zone' ? (
        <div className="flex flex-col gap-4">
          <PickerMap
            styleUrl={mapStyleUrl}
            area={{ center: frame, radiusM: alertRadiusM(radiusKm) }}
            value={center}
            radiusM={alertRadiusM(radiusKm)}
            onChange={setCenter}
            unavailable={
              <Notice tone="neutral" title={t('map.unavailable')}>
                {t('map.use_location_instead')}
              </Notice>
            }
          />
          <Button variant="secondary" onClick={useMyLocation} disabled={locating}>
            <LocateFixed aria-hidden="true" />
            {t(locating ? 'map.locating' : 'map.use_my_location')}
          </Button>
          <h3 className="m-0 text-2xl font-extrabold">
            {t('auth.profile.alerts.sheet.zone_pick')}
          </h3>
          <p className="m-0 text-muted">
            {t('auth.profile.alerts.sheet.zone_hint', { km: radiusKm })}
          </p>
          <Chips
            label={t('auth.profile.alerts.sheet.radius_label')}
            options={ALERT_RADII_KM.map(
              (km): Option<string> => ({
                value: String(km),
                label: t('auth.profile.alerts.sheet.radius_option', { km }),
              }),
            )}
            value={String(radiusKm)}
            onChange={(value) => {
              const km = Number(value)
              if (isAlertRadius(km)) setRadiusKm(km)
            }}
          />
          {tried && !center ? (
            <p role="alert" className="m-0 text-sm font-semibold text-lost-deep">
              {t('auth.profile.alerts.sheet.need_point')}
            </p>
          ) : null}
          {set.isError ? (
            <p role="alert" className="m-0 text-sm font-semibold text-lost-deep">
              {t('auth.profile.alerts.sheet.save_failed')}
            </p>
          ) : null}
          <Button disabled={set.isPending} onClick={confirm}>
            {t(
              set.isPending
                ? 'auth.profile.alerts.sheet.saving'
                : 'auth.profile.alerts.sheet.confirm',
            )}
          </Button>
        </div>
      ) : null}

      {step === 'done' ? (
        <div className="flex flex-col gap-4">
          <Notice tone="success" title={t('auth.profile.alerts.sheet.done_title')}>
            {t('auth.profile.alerts.sheet.done_body')}
          </Notice>
          <Button onClick={onClose}>{t('common.done')}</Button>
        </div>
      ) : null}
    </Sheet>
  )
}
