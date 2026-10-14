// Loaded lazily by PickerMap: tap the map to say where.
import type { FeatureCollection } from 'geojson'
import { useEffect, useRef } from 'react'
import { boundsOf, circleRing } from './geometry'
import { cssColor, type GeoJSONSource, GlMap } from './maplibre'
import type { MapArea, MapPoint } from './types'

type Props = {
  styleUrl: string
  /** What to frame at first, drawn as a dashed circle for context. */
  area: MapArea
  value: MapPoint | null
  onChange: (point: MapPoint) => void
  onError: () => void
}

const picked = (value: MapPoint | null): FeatureCollection => ({
  type: 'FeatureCollection',
  features: value
    ? [
        {
          type: 'Feature',
          properties: {},
          geometry: { type: 'Point', coordinates: [value.lng, value.lat] },
        },
      ]
    : [],
})

export default function MapLibrePicker({ styleUrl, area, value, onChange, onError }: Props) {
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<GlMap | null>(null)
  const latest = useRef({ area, value, onChange, onError })
  latest.current = { area, value, onChange, onError }

  useEffect(() => {
    const element = container.current
    if (!element) return
    let map: GlMap
    try {
      map = new GlMap({
        container: element,
        style: styleUrl,
        bounds: boundsOf(latest.current.area, []),
        fitBoundsOptions: { padding: 40, maxZoom: 16 },
        attributionControl: { compact: true },
      })
    } catch {
      latest.current.onError()
      return
    }

    map.on('load', () => {
      const lost = cssColor('--color-lost')
      map.addSource('area', {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: { type: 'Polygon', coordinates: [circleRing(latest.current.area)] },
        },
      })
      map.addLayer({
        id: 'area-fill',
        type: 'fill',
        source: 'area',
        paint: { 'fill-color': lost, 'fill-opacity': 0.1 },
      })
      map.addLayer({
        id: 'area-edge',
        type: 'line',
        source: 'area',
        paint: { 'line-color': lost, 'line-width': 2, 'line-dasharray': [3, 2] },
      })
      map.addSource('picked', { type: 'geojson', data: picked(latest.current.value) })
      map.addLayer({
        id: 'picked',
        type: 'circle',
        source: 'picked',
        paint: {
          'circle-radius': 13,
          'circle-color': cssColor('--color-brand'),
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 4,
        },
      })
      map.on('click', (event) => {
        latest.current.onChange({ lat: event.lngLat.lat, lng: event.lngLat.lng })
      })
      map.getCanvas().style.cursor = 'crosshair'
      mapRef.current = map
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
    ;(map.getSource('picked') as GeoJSONSource).setData(picked(value))
    // A point chosen from outside the view (device location) is brought into it.
    if (value && !map.getBounds().contains([value.lng, value.lat])) {
      map.easeTo({ center: [value.lng, value.lat] })
    }
  }, [value])

  return <div ref={container} className="h-72 w-full lg:h-80" data-testid="picker-map" />
}
