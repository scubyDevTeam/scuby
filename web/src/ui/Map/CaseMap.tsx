import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { OnError } from './OnError'
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
  /** A pin tapped: the page opens its sheet (04 · Display rules 3). */
  onSelectPin?: (id: string) => void
}

/** The area, the sighting pins and their trajectory — on a real map when the device can. */
export function CaseMap({ styleUrl, area, areaLabel, pins, onSelectPin }: Props) {
  const [failed, setFailed] = useState(false)
  const [holder, ready] = useWhenSettledAndNear()
  const schematic = (
    <SchematicMap area={area} areaLabel={areaLabel} pins={pins} onSelectPin={onSelectPin} />
  )
  if (!styleUrl || failed) return schematic
  // The drawing holds the place until the page has painted and the map is about to be seen: the
  // ~250 KB of MapLibre and its tiles never compete with the case for the first paint.
  if (!ready) return <div ref={holder}>{schematic}</div>

  return (
    <OnError fallback={schematic}>
      <Suspense fallback={<div className="aspect-square animate-pulse rounded-2xl bg-soft" />}>
        <figure className="m-0 overflow-hidden rounded-2xl bg-soft">
          <MapLibreMap
            styleUrl={styleUrl}
            area={area}
            pins={pins}
            onSelectPin={onSelectPin}
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

/** True once the page has finished loading, is idle, and the element is within a screen of view. */
function useWhenSettledAndNear() {
  const ref = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let observer: IntersectionObserver | undefined
    let cancelled = false
    const watch = () => {
      if (cancelled) return
      const element = ref.current
      if (!element || typeof IntersectionObserver === 'undefined') return setReady(true)
      observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            observer?.disconnect()
            setReady(true)
          }
        },
        { rootMargin: '100% 0px' },
      )
      observer.observe(element)
    }
    const idle = () => {
      // Safari has no requestIdleCallback.
      if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(watch, { timeout: 2000 })
      } else {
        setTimeout(watch, 200)
      }
    }
    if (document.readyState === 'complete') idle()
    else window.addEventListener('load', idle, { once: true })
    return () => {
      cancelled = true
      observer?.disconnect()
      window.removeEventListener('load', idle)
    }
  }, [])
  return [ref, ready] as const
}
