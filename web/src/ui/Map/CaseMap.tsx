import { Component, lazy, type ReactNode, Suspense, useState } from 'react'
import { SchematicMap } from './SchematicMap'
import type { MapArea, MapPin } from './types'

// MapLibre is ~250 KB: it loads only when a map is on screen, never in the entry chunk.
const MapLibreMap = lazy(() => import('./MapLibreMap'))

type Props = {
  /** Tile style to draw on. Without one, the tile-less drawing is all there is. */
  styleUrl: string | undefined
  area: MapArea
  areaLabel: string
  pins: readonly MapPin[]
}

/** The area, the sighting pins and their trajectory — on a real map when the device can. */
export function CaseMap({ styleUrl, area, areaLabel, pins }: Props) {
  const [failed, setFailed] = useState(false)
  const schematic = <SchematicMap area={area} areaLabel={areaLabel} pins={pins} />
  if (!styleUrl || failed) return schematic

  return (
    <OnError fallback={schematic}>
      <Suspense fallback={<div className="aspect-square animate-pulse rounded-2xl bg-soft" />}>
        <figure className="m-0 overflow-hidden rounded-2xl bg-soft">
          <MapLibreMap
            styleUrl={styleUrl}
            area={area}
            pins={pins}
            onError={() => setFailed(true)}
          />
          <figcaption className="px-4 py-3 text-sm font-semibold text-lost-ink">
            {areaLabel}
          </figcaption>
        </figure>
      </Suspense>
    </OnError>
  )
}

/** The map chunk failing to load (offline) must not take the case page down with it. */
class OnError extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}
