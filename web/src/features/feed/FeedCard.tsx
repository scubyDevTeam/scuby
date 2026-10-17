import type { FeedItem } from '@contracts/feed'
import { useI18n } from '@i18n/react'
import type { Translator } from '@i18n/translate'
import { Badge, type BadgeTone } from '@ui/Badge'
import type { ReactNode } from 'react'

// The badge reads `feed.badge.<vertical>`.
export const verticalTone: Record<FeedItem['vertical'], BadgeTone> = {
  lost: 'lost',
  found: 'found',
  adoption: 'adoption',
  help: 'help',
}

export function secondLine(i18n: Translator, item: FeedItem, now: Date): string {
  if (item.detail) return `${item.placeName} · ${item.detail}`
  return `${item.placeName} · ${i18n.relative(item.happenedAt, now)}`
}

function sightingLine(i18n: Translator, item: FeedItem, now: Date): string | null {
  if (!item.lastSightingAt || !item.sightingsCount) return null
  return i18n.t('feed.sightings', {
    count: item.sightingsCount,
    when: i18n.relative(item.lastSightingAt, now),
  })
}

export function FeedCard({
  item,
  now,
  wide,
  link,
}: {
  item: FeedItem
  now: Date
  /** The first card spans the row with the photo on the side. */
  wide: boolean
  /** Wraps the card in the link to its case; the router lives in `routes`. */
  link: (children: ReactNode) => ReactNode
}) {
  const i18n = useI18n()
  const sighting = sightingLine(i18n, item, now)
  return link(
    <article
      className={`h-full overflow-hidden rounded-(--radius-card) bg-surface shadow-md ${wide ? 'flex' : ''}`}
    >
      {item.photoUrl ? (
        <img
          src={item.photoUrl}
          alt=""
          loading="lazy"
          className={wide ? 'w-2/5 object-cover' : 'aspect-square w-full object-cover'}
        />
      ) : (
        <div className={wide ? 'w-2/5 bg-soft' : 'aspect-square w-full bg-soft'} />
      )}
      <div className="flex min-w-0 flex-1 flex-col items-start gap-1 p-4">
        <div className="flex flex-wrap gap-1">
          <Badge tone={verticalTone[item.vertical]}>{i18n.t(`feed.badge.${item.vertical}`)}</Badge>
          {item.possibleFind ? <Badge tone="info">{i18n.t('feed.possible_find')}</Badge> : null}
        </div>
        <h3 className="m-0 text-xl font-extrabold">{item.title}</h3>
        {wide && item.summary ? <p className="m-0 text-muted">{item.summary}</p> : null}
        <p className={`m-0 ${wide ? 'font-bold' : 'text-muted'}`}>{secondLine(i18n, item, now)}</p>
        {wide && sighting ? <p className="m-0 text-muted">{sighting}</p> : null}
      </div>
    </article>,
  )
}
