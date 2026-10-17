import type { FeedItem } from '@contracts/feed'
import { useI18n } from '@i18n/react'
import { Badge } from '@ui/Badge'
import { buttonClass } from '@ui/Button'
import type { ReactNode } from 'react'
import { secondLine, verticalTone } from './FeedCard'

/**
 * A feed pin's card (design «Inicio · mapa»): photo, what it is, the case's name, place and time,
 * and the way to its page. Lazy, with its words: only a tap on the map pays for it.
 */
export function FeedPinCard({
  item,
  now,
  link,
}: {
  item: FeedItem
  now: Date
  /** The link to the case's page; the router lives in `routes`. */
  link: (children: ReactNode) => ReactNode
}) {
  const i18n = useI18n()
  return (
    <>
      {item.photoUrl ? (
        <img src={item.photoUrl} alt="" className="size-20 shrink-0 rounded-2xl object-cover" />
      ) : (
        <div className="size-20 shrink-0 rounded-2xl bg-soft" />
      )}
      <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
        <Badge tone={verticalTone[item.vertical]}>{i18n.t(`feed.badge.${item.vertical}`)}</Badge>
        <h3 className="m-0 truncate text-xl font-extrabold">{item.title}</h3>
        <p className="m-0 text-sm text-muted">{secondLine(i18n, item, now)}</p>
      </div>
      <div className="shrink-0">
        {link(
          <span className={buttonClass('primary', 'w-auto')}>{i18n.t('map_sheet.feed.view')}</span>,
        )}
      </div>
    </>
  )
}
