import type { FeedItem } from '@contracts/feed'
import { formatRelative } from '@domain/shared/time'
import { Badge, type BadgeTone } from '@ui/Badge'
import type { ReactNode } from 'react'

const verticalBadge: Record<FeedItem['vertical'], { tone: BadgeTone; label: string }> = {
  lost: { tone: 'lost', label: 'Se busca' },
  found: { tone: 'found', label: 'Se encontró' },
  adoption: { tone: 'adoption', label: 'En adopción' },
  help: { tone: 'help', label: 'Necesita ayuda' },
}

function secondLine(item: FeedItem, now: Date): string {
  if (item.detail) return `${item.placeName} · ${item.detail}`
  return `${item.placeName} · ${formatRelative(item.happenedAt, now)}`
}

function sightingLine(item: FeedItem, now: Date): string | null {
  if (!item.lastSightingAt || !item.sightingsCount) return null
  const seen = `Vista ${formatRelative(item.lastSightingAt, now)}`
  return `${seen} · ${item.sightingsCount} ${item.sightingsCount === 1 ? 'avistamiento' : 'avistamientos'}`
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
  const badge = verticalBadge[item.vertical]
  const sighting = sightingLine(item, now)
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
          <Badge tone={badge.tone}>{badge.label}</Badge>
          {item.possibleFind ? <Badge tone="info">Posible hallazgo</Badge> : null}
        </div>
        <h3 className="m-0 text-xl font-extrabold">{item.title}</h3>
        {wide && item.summary ? <p className="m-0 text-muted">{item.summary}</p> : null}
        <p className={`m-0 ${wide ? 'font-bold' : 'text-muted'}`}>{secondLine(item, now)}</p>
        {wide && sighting ? <p className="m-0 text-muted">{sighting}</p> : null}
      </div>
    </article>,
  )
}
