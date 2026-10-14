import type { Sighting } from '@contracts/case'
import type { PlacedSighting } from '@domain/lost/sightings'
import { formatDistance } from '@domain/shared/geo'
import { formatRelative } from '@domain/shared/time'
import { formatSeenAt } from './copy'

/** docs/product/04 · Display rules §4: newest first — time, distance, thumbnail, reporter type. */
export function SightingTimeline({
  sightings,
  now,
}: {
  sightings: readonly PlacedSighting<Sighting>[]
  now: Date
}) {
  const newestFirst = [...sightings].reverse()
  return (
    <ol className="m-0 flex list-none flex-col gap-3 p-0">
      {newestFirst.map((sighting) => (
        <li
          key={sighting.id}
          className={`flex items-start gap-3 rounded-2xl p-4 ${
            sighting.isLatest ? 'border-2 border-brand bg-surface' : 'bg-brand-mist'
          }`}
        >
          <span
            className={`flex size-9 shrink-0 items-center justify-center rounded-full font-bold ${
              sighting.isLatest ? 'bg-brand text-white' : 'bg-brand-ice text-brand-deep'
            }`}
          >
            {sighting.order}
          </span>
          <div className="min-w-0 flex-1">
            <p className="m-0 font-bold">
              {formatSeenAt(sighting.seenAt, now)} · {formatRelative(sighting.seenAt, now)}
            </p>
            <p className="m-0 text-muted">
              A {formatDistance(sighting.distanceFromLastSeenM)} ·{' '}
              {sighting.source === 'registered' ? 'con cuenta' : 'anónimo'}
            </p>
            {sighting.note ? <p className="m-0 text-muted">«{sighting.note}»</p> : null}
          </div>
          {sighting.photoUrl ? (
            <img
              src={sighting.photoUrl}
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
