// Loaded lazily by FeedMap: many cases as coloured GL circles, tappable.
import type { FeatureCollection } from 'geojson'
import { useEffect, useRef } from 'react'
import { cssColor, type GeoJSONSource, GlMap } from './maplibre'
import type { MapMarker } from './types'

type Props = {
  styleUrl: string
  markers: readonly MapMarker[]
  onSelect: (id: string) => void
  onError: () => void
}

const toneColor = {
  lost: '--color-lost',
  found: '--color-found',
  adoption: '--color-adoption',
  help: '--color-help',
} as const

function collection(markers: readonly MapMarker[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: markers.map((marker) => ({
      type: 'Feature',
      properties: { id: marker.id, color: cssColor(toneColor[marker.tone]) },
      geometry: { type: 'Point', coordinates: [marker.point.lng, marker.point.lat] },
    })),
  }
}

function bounds(markers: readonly MapMarker[]): [number, number, number, number] {
  const lngs = markers.map((m) => m.point.lng)
  const lats = markers.map((m) => m.point.lat)
  return [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)]
}

export default function MapLibrePoints({ styleUrl, markers, onSelect, onError }: Props) {
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<GlMap | null>(null)
  const latest = useRef({ markers, onSelect, onError })
  latest.current = { markers, onSelect, onError }

  useEffect(() => {
    const element = container.current
    if (!element) return
    let map: GlMap
    try {
      map = new GlMap({
        container: element,
        style: styleUrl,
        attributionControl: { compact: true },
        cooperativeGestures: true,
      })
    } catch {
      latest.current.onError()
      return
    }

    map.on('load', () => {
      map.addSource('cases', { type: 'geojson', data: collection(latest.current.markers) })
      map.addLayer({
        id: 'cases',
        type: 'circle',
        source: 'cases',
        paint: {
          'circle-radius': 11,
          'circle-color': ['get', 'color'],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 3,
        },
      })
      map.on('click', 'cases', (event) => {
        const id = event.features?.[0]?.properties?.id
        if (typeof id === 'string') latest.current.onSelect(id)
      })
      map.on('mouseenter', 'cases', () => {
        map.getCanvas().style.cursor = 'pointer'
      })
      map.on('mouseleave', 'cases', () => {
        map.getCanvas().style.cursor = ''
      })
      mapRef.current = map
      fitToMarkers(map, latest.current.markers)
      element.dataset.mapReady = 'true'
    })

    return () => {
      mapRef.current = null
      map.remove()
    }
  }, [styleUrl])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    ;(map.getSource('cases') as GeoJSONSource).setData(collection(markers))
    fitToMarkers(map, markers)
  }, [markers])

  return <div ref={container} className="h-full min-h-96 w-full" data-testid="feed-map" />
}

function fitToMarkers(map: GlMap, markers: readonly MapMarker[]) {
  if (markers.length === 0) return
  map.fitBounds(bounds(markers), { padding: 56, maxZoom: 15, duration: 0 })
}
