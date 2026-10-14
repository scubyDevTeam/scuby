import { lazy, type ReactNode, Suspense, useState } from 'react'
import { OnError } from './OnError'
import type { MapMarker } from './types'

const MapLibrePoints = lazy(() => import('./MapLibrePoints'))

type Props = {
  styleUrl: string | undefined
  markers: readonly MapMarker[]
  onSelect: (id: string) => void
  /** Shown when there is no tile style, no WebGL, or the map could not load. */
  unavailable: ReactNode
}

/** Every case of the feed on one map. Unlike a case's own map, this one has no tile-less form. */
export function FeedMap({ styleUrl, markers, onSelect, unavailable }: Props) {
  const [failed, setFailed] = useState(false)
  if (!styleUrl || failed) return unavailable

  return (
    <OnError fallback={unavailable}>
      <Suspense fallback={<div className="h-full min-h-96 animate-pulse rounded-2xl bg-soft" />}>
        <div className="h-full overflow-hidden rounded-2xl bg-soft">
          <MapLibrePoints
            styleUrl={styleUrl}
            markers={markers}
            onSelect={onSelect}
            onError={() => setFailed(true)}
          />
        </div>
      </Suspense>
    </OnError>
  )
}
