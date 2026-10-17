import { lazy, type ReactNode, Suspense, useState } from 'react'
import { OnError } from './OnError'
import type { MapMarker } from './types'

const MapLibrePoints = lazy(() => import('./MapLibrePoints'))

type Props = {
  styleUrl: string | undefined
  markers: readonly MapMarker[]
  /** The case whose card is open: drawn larger. */
  selectedId: string | null
  /** A case tapped; `null` when the map around the pins is. */
  onSelect: (id: string | null) => void
  /** The selected case's card, over the bottom of the map (a `PinCard`). */
  card?: ReactNode
  /** Shown when there is no tile style, no WebGL, or the map could not load. */
  unavailable: ReactNode
}

/**
 * Every case of the feed on one map, grouped where they crowd. Unlike a case's own map this one has
 * no tile-less form: the list beside it (or one tap away on a phone) carries the same cases, and is
 * the way to them without a pointer.
 */
export function FeedMap({ styleUrl, markers, selectedId, onSelect, card, unavailable }: Props) {
  const [failed, setFailed] = useState(false)
  if (!styleUrl || failed) return unavailable

  return (
    <OnError fallback={unavailable}>
      <Suspense fallback={<div className="h-full min-h-96 animate-pulse rounded-2xl bg-soft" />}>
        <div className="relative h-full overflow-hidden rounded-2xl bg-soft">
          <MapLibrePoints
            styleUrl={styleUrl}
            markers={markers}
            selectedId={selectedId}
            onSelect={onSelect}
            onError={() => setFailed(true)}
          />
          {card ? <div className="absolute inset-x-3 bottom-3">{card}</div> : null}
        </div>
      </Suspense>
    </OnError>
  )
}
