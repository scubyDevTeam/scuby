import { lazy, type ReactNode, Suspense, useState } from 'react'
import { OnError } from './OnError'
import type { MapArea, MapPoint } from './types'

const MapLibrePicker = lazy(() => import('./MapLibrePicker'))

type Props = {
  styleUrl: string | undefined
  area: MapArea
  value: MapPoint | null
  onChange: (point: MapPoint) => void
  /** Shown instead of the map when it cannot load: the caller still has to offer a way to answer. */
  unavailable: ReactNode
}

/** Asks «where?» by letting the person tap the spot. */
export function PickerMap({ styleUrl, area, value, onChange, unavailable }: Props) {
  const [failed, setFailed] = useState(false)
  if (!styleUrl || failed) return unavailable

  return (
    <OnError fallback={unavailable}>
      <Suspense fallback={<div className="h-72 animate-pulse rounded-2xl bg-soft lg:h-80" />}>
        <div className="overflow-hidden rounded-2xl bg-soft">
          <MapLibrePicker
            styleUrl={styleUrl}
            area={area}
            value={value}
            onChange={onChange}
            onError={() => setFailed(true)}
          />
        </div>
      </Suspense>
    </OnError>
  )
}
