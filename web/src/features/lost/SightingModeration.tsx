import { useModerateSighting } from '@api-client/owner'
import type { Sighting } from '@contracts/case'
import {
  moderationChange,
  moderationOptions,
  type SightingModeration,
} from '@domain/lost/sightings'
import { useI18n } from '@i18n/react'
import { Button } from '@ui/Button'
import { Notice } from '@ui/Notice'
import { EyeOff, Star } from 'lucide-react'
import { formatSeenAt } from './copy'

/**
 * The owner's hand on one pin (docs/product/04 · Display rules 3 and 5): «Marcar como útil» — a
 * toggle, so a starred pin reads as pressed — and hide, or the way back for a hidden one.
 */
export function SightingTools({ code, sighting }: { code: string; sighting: Sighting }) {
  const { t } = useI18n()
  const moderate = useModerateSighting(code)
  const send = (option: SightingModeration) =>
    moderate.mutate({ sightingId: sighting.id, ...moderationChange(option) })

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-x-4">
        {moderationOptions(sighting, 'owner').map((option) =>
          option === 'highlight' || option === 'unhighlight' ? (
            <Button
              key={option}
              variant="link"
              aria-pressed={option === 'unhighlight'}
              disabled={moderate.isPending}
              onClick={() => send(option)}
            >
              <Star
                aria-hidden="true"
                className="size-4"
                fill={option === 'unhighlight' ? 'currentColor' : 'none'}
              />
              {t('lost.moderation.highlight')}
            </Button>
          ) : (
            <Button
              key={option}
              variant="link"
              className="font-normal text-muted"
              disabled={moderate.isPending}
              onClick={() => send(option)}
            >
              {option === 'hide' ? <EyeOff aria-hidden="true" className="size-4" /> : null}
              {t(option === 'hide' ? 'lost.moderation.hide' : 'lost.moderation.unhide')}
            </Button>
          ),
        )}
      </div>
      {moderate.isError ? (
        <Notice tone="warning" title={t('lost.moderation.failed_title')}>
          {t('common.try_again')}
        </Notice>
      ) : null}
    </div>
  )
}

/** The pins the owner took off the public map: only they get them, and they can bring them back. */
export function HiddenSightings({
  code,
  sightings,
  now,
}: {
  code: string
  sightings: readonly Sighting[]
  now: Date
}) {
  const i18n = useI18n()
  const { t } = i18n
  if (sightings.length === 0) return null
  return (
    <section className="flex flex-col gap-2">
      <h3 className="m-0 text-lg font-bold">{t('lost.moderation.hidden_title')}</h3>
      <p className="m-0 text-sm text-muted">{t('lost.moderation.hidden_hint')}</p>
      <ul
        aria-label={t('lost.moderation.hidden_label')}
        className="m-0 flex list-none flex-col gap-2 p-0"
      >
        {[...sightings].reverse().map((sighting) => (
          <li key={sighting.id} className="rounded-2xl border-2 border-dashed border-soft p-4">
            <p className="m-0 font-bold text-muted">
              {formatSeenAt(i18n, sighting.seenAt, now)} · {i18n.relative(sighting.seenAt, now)}
            </p>
            {sighting.note ? (
              <p className="m-0 text-muted">{t('lost.timeline.note', { note: sighting.note })}</p>
            ) : null}
            <SightingTools code={code} sighting={sighting} />
          </li>
        ))}
      </ul>
    </section>
  )
}
