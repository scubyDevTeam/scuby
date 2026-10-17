import {
  type QueuedSighting,
  useDismissQueued,
  useQueuedSightings,
} from '@api-client/sighting-queue'
import type { SightingError } from '@domain/lost/sightings'
import { useI18n } from '@i18n/react'
import type { Translator } from '@i18n/translate'
import { Button } from '@ui/Button'
import { sightingErrorCopy } from './copy'

const RULE_FOR_CODE: Partial<Record<string, SightingError>> = {
  sighting_too_far: 'too_far',
  seen_at_in_future: 'in_the_future',
  seen_at_before_case: 'before_the_case',
}

/** Why the server refused a sighting that waited for a signal, when the words for it exist. */
export function rejectionCopy(i18n: Translator, code: string, petName: string): string | null {
  if (code === 'rate_limited') return i18n.t('lost.sighting_form.too_soon')
  const rule = RULE_FOR_CODE[code]
  return rule ? sightingErrorCopy(i18n, rule, petName) : null
}

/** One sighting of this device that has not reached the server (the design's «En espera» card). */
export function QueuedCard({
  sighting,
  petName,
  now,
  onDismiss,
}: {
  sighting: QueuedSighting
  petName: string
  now: Date
  onDismiss?: () => void
}) {
  const i18n = useI18n()
  const { t } = i18n
  const reason = sighting.rejected ? rejectionCopy(i18n, sighting.rejected, petName) : null
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-brand-mist p-4">
      <div className="min-w-0 flex-1">
        <p className="m-0 font-bold">
          {t('lost.queued.seen', {
            name: petName,
            ago: i18n.relative(new Date(sighting.seenAt), now),
          })}
        </p>
        {sighting.note ? (
          <p className="m-0 text-muted">{t('lost.timeline.note', { note: sighting.note })}</p>
        ) : null}
        {reason ? <p className="m-0 text-sm font-semibold text-lost-deep">{reason}</p> : null}
        {sighting.rejected && onDismiss ? (
          <Button variant="link" onClick={onDismiss}>
            {t('lost.queued.dismiss')}
          </Button>
        ) : null}
      </div>
      <span
        className={`shrink-0 rounded-xl px-3 py-1 text-sm font-bold ${
          sighting.rejected ? 'bg-surface text-lost-deep' : 'bg-brand-ice text-brand-deep'
        }`}
      >
        {t(sighting.rejected ? 'lost.queued.not_sent' : 'lost.queued.waiting')}
      </span>
    </div>
  )
}

/**
 * The reporter's own sightings on this case that are still waiting for a signal — or that the
 * server refused when they finally went (never a silent drop: docs/product/04 · Validation). Local
 * to this device; once one is sent it is an ordinary pin on the trail.
 */
export function QueuedSightings({
  code,
  petName,
  now,
}: {
  code: string
  petName: string
  now: Date
}) {
  const { t } = useI18n()
  const queued = useQueuedSightings(code)
  const dismiss = useDismissQueued()
  if (queued.length === 0) return null
  return (
    <ul aria-label={t('lost.queued.label')} className="m-0 flex list-none flex-col gap-3 p-0">
      {queued.map((sighting) => (
        <li key={sighting.id}>
          <QueuedCard
            sighting={sighting}
            petName={petName}
            now={now}
            onDismiss={() => dismiss(sighting.id)}
          />
        </li>
      ))}
    </ul>
  )
}
