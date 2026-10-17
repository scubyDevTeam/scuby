import type { Sighting } from '@contracts/case'
import type { PlacedSighting } from '@domain/lost/sightings'
import { useI18n } from '@i18n/react'
import type { ReactNode } from 'react'
import { formatSeenAt } from './copy'

/** docs/product/04 · Display rules §4: newest first — time, distance, thumbnail, reporter type. */
export function SightingTimeline({
  sightings,
  now,
  onOpen,
  tools,
}: {
  sightings: readonly PlacedSighting<Sighting>[]
  now: Date
  /** Its number opens the pin's sheet: the way to it without a pointer, as GL pins take no focus. */
  onOpen: (id: string) => void
  /** The owner's hide / highlight under each item (display rule 3); nothing for anyone else. */
  tools?: (sighting: Sighting) => ReactNode
}) {
  const i18n = useI18n()
  const { t } = i18n
  const newestFirst = [...sightings].reverse()
  return (
    <ol aria-label={t('lost.timeline.label')} className="m-0 flex list-none flex-col gap-3 p-0">
      {newestFirst.map((sighting) => (
        <li
          key={sighting.id}
          className={`flex items-start gap-3 rounded-2xl p-4 ${
            sighting.isLatest ? 'border-2 border-brand bg-surface' : 'bg-brand-mist'
          }`}
        >
          <button
            type="button"
            aria-label={t('map_pin.open_sighting', { n: sighting.order })}
            onClick={() => onOpen(sighting.id)}
            className={`flex size-9 shrink-0 items-center justify-center rounded-full font-bold ${
              sighting.isLatest ? 'bg-brand text-white' : 'bg-brand-ice text-brand-deep'
            }`}
          >
            {sighting.order}
          </button>
          <div className="min-w-0 flex-1">
            <p className="m-0 font-bold">
              {formatSeenAt(i18n, sighting.seenAt, now)} · {i18n.relative(sighting.seenAt, now)}
            </p>
            <p className="m-0 text-muted">
              {t('lost.timeline.where_who', {
                distance: i18n.distance(sighting.distanceFromLastSeenM),
                reporter: t(
                  sighting.source === 'registered'
                    ? 'lost.timeline.registered'
                    : 'lost.timeline.anonymous',
                ),
              })}
            </p>
            {sighting.note ? (
              <p className="m-0 text-muted">{t('lost.timeline.note', { note: sighting.note })}</p>
            ) : null}
            {tools?.(sighting)}
          </div>
          {sighting.photoUrls[0] ? (
            <img
              src={sighting.photoUrls[0]}
              alt=""
              loading="lazy"
              className="size-12 shrink-0 rounded-lg object-cover"
            />
          ) : null}
        </li>
      ))}
    </ol>
  )
}
