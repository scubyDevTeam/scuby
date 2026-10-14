import { lazy, type ReactNode, Suspense, useState } from 'react'
import { OnError } from './OnError'
import type { MapArea, MapPoint } from './types'

const MapLibrePicker = lazy(() => import('./MapLibrePicker'))

type Props = {
  styleUrl: string | undefined
  area: MapArea
  showArea?: boolean
  value: MapPoint | null
  radiusM?: number
  onChange: (point: MapPoint) => void
  /** Shown instead of the map when it cannot load: the caller still has to offer a way to answer. */
  unavailable: ReactNode
}

/** Asks «where?» by letting the person tap the spot. */
export function PickerMap({
  styleUrl,
  area,
  showArea,
  value,
  radiusM,
  onChange,
  unavailable,
}: Props) {
  const [failed, setFailed] = useState(false)
  if (!styleUrl || failed) return unavailable

  return (
    <OnError fallback={unavailable}>
      <Suspense fallback={<div className="h-72 animate-pulse rounded-2xl bg-soft lg:h-80" />}>
        <div className="overflow-hidden rounded-2xl bg-soft">
          <MapLibrePicker
            styleUrl={styleUrl}
            area={area}
            showArea={showArea}
            value={value}
            radiusM={radiusM}
            onChange={onChange}
            onError={() => setFailed(true)}
          />
        </div>
      </Suspense>
    </OnError>
  )
}
