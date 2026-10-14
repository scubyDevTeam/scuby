// The only file that imports MapLibre (frontend.md · Rule 5). Loaded lazily by CaseMap.
// Everything is a GL layer — no DOM markers, which crawl past a few hundred pins.
import type { FeatureCollection, GeoJSON } from 'geojson'
import { type GeoJSONSource, Map as GlMap, setWorkerUrl } from 'maplibre-gl'
// The library resolves its worker at runtime; the bundler has to be told to build and serve it.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useEffect, useRef } from 'react'
import { bandOpacity, boundsOf, circleRing, pinIconName, trajectory } from './geometry'
import type { MapArea, MapPin } from './types'

type Props = {
  styleUrl: string
  area: MapArea
  pins: readonly MapPin[]
  onError: () => void
}

setWorkerUrl(workerUrl)

const cssColor = (name: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim()

/** Numbered pins and their labels are drawn to images, so they need no glyphs from the style. */
function pinImage(order: number, strong: boolean): ImageData {
  const size = strong ? 72 : 52
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.beginPath()
  ctx.arc(size / 2, size / 2, size / 2 - 5, 0, 2 * Math.PI)
  ctx.fillStyle = strong ? cssColor('--color-brand') : cssColor('--color-brand-ice')
  ctx.fill()
  ctx.lineWidth = 6
  ctx.strokeStyle = strong ? '#ffffff' : cssColor('--color-brand')
  ctx.stroke()
  ctx.fillStyle = strong ? '#ffffff' : cssColor('--color-brand-deep')
  ctx.font = `bold ${strong ? 30 : 24}px system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(String(order), size / 2, size / 2 + 1)
  return ctx.getImageData(0, 0, size, size)
}

function labelImage(text: string): ImageData {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')!
  ctx.font = 'bold 26px system-ui, sans-serif'
  canvas.width = Math.ceil(ctx.measureText(text).width) + 32
  canvas.height = 48
  ctx.fillStyle = cssColor('--color-brand')
  ctx.beginPath()
  ctx.roundRect(0, 0, canvas.width, canvas.height, 14)
  ctx.fill()
  ctx.font = 'bold 26px system-ui, sans-serif'
  ctx.fillStyle = '#ffffff'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 1)
  return ctx.getImageData(0, 0, canvas.width, canvas.height)
}

function draw(map: GlMap, area: MapArea, pins: readonly MapPin[]) {
  const set = (id: string, data: GeoJSON) => (map.getSource(id) as GeoJSONSource).setData(data)

  set('area', {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Polygon', coordinates: [circleRing(area)] },
  })
  set('trajectory', {
    type: 'Feature',
    properties: {},
    geometry: { type: 'LineString', coordinates: pins.length > 1 ? trajectory(pins) : [] },
  })

  for (const pin of pins) {
    const icon = pinIconName(pin)
    if (!map.hasImage(icon))
      map.addImage(icon, pinImage(pin.order, pin.emphasized), { pixelRatio: 2 })
    if (pin.label && !map.hasImage(`label-${pin.label}`)) {
      map.addImage(`label-${pin.label}`, labelImage(pin.label), { pixelRatio: 2 })
    }
  }
  set('pins', {
    type: 'FeatureCollection',
    features: pins.map((pin) => ({
      type: 'Feature',
      properties: {
        id: pin.id,
        icon: pinIconName(pin),
        label: pin.label ? `label-${pin.label}` : '',
        opacity: pin.emphasized ? 1 : bandOpacity[pin.band],
        order: pin.order,
      },
      geometry: { type: 'Point', coordinates: [pin.point.lng, pin.point.lat] },
    })),
  })
}

export default function MapLibreMap({ styleUrl, area, pins, onError }: Props) {
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<GlMap | null>(null)
  const latest = useRef({ area, pins, onError })
  latest.current = { area, pins, onError }

  useEffect(() => {
    const element = container.current
    if (!element) return
    let map: GlMap
    try {
      map = new GlMap({
        container: element,
        style: styleUrl,
        bounds: boundsOf(latest.current.area, latest.current.pins),
        // Room for the pins at the edge and for the label above the newest one.
        fitBoundsOptions: { padding: { top: 72, right: 40, bottom: 40, left: 40 }, maxZoom: 16 },
        attributionControl: { compact: true },
        // One finger scrolls the page the map sits in; two fingers move the map.
        cooperativeGestures: true,
      })
    } catch {
      // No WebGL on this device.
      latest.current.onError()
      return
    }
    const empty: FeatureCollection = { type: 'FeatureCollection', features: [] }
    const lost = cssColor('--color-lost')

    map.on('load', () => {
      for (const id of ['area', 'trajectory', 'pins'])
        map.addSource(id, { type: 'geojson', data: empty })
      map.addLayer({
        id: 'area-fill',
        type: 'fill',
        source: 'area',
        paint: { 'fill-color': lost, 'fill-opacity': 0.15 },
      })
      map.addLayer({
        id: 'area-edge',
        type: 'line',
        source: 'area',
        paint: { 'line-color': lost, 'line-width': 2, 'line-dasharray': [3, 2] },
      })
      map.addLayer({
        id: 'trajectory',
        type: 'line',
        source: 'trajectory',
        layout: { 'line-cap': 'round' },
        paint: {
          'line-color': cssColor('--color-ink'),
          'line-width': 3,
          'line-dasharray': [0.2, 2.2],
        },
      })
      map.addLayer({
        id: 'pins',
        type: 'symbol',
        source: 'pins',
        layout: {
          'icon-image': ['get', 'icon'],
          'icon-allow-overlap': true,
          // The newest pin draws last, on top.
          'symbol-sort-key': ['get', 'order'],
        },
        paint: { 'icon-opacity': ['get', 'opacity'] },
      })
      map.addLayer({
        id: 'pin-labels',
        type: 'symbol',
        source: 'pins',
        filter: ['!=', ['get', 'label'], ''],
        layout: {
          'icon-image': ['get', 'label'],
          'icon-anchor': 'bottom',
          'icon-offset': [0, -44],
          'icon-allow-overlap': true,
        },
      })
      mapRef.current = map
      draw(map, latest.current.area, latest.current.pins)
      element.dataset.mapReady = 'true'
    })

    return () => {
      mapRef.current = null
      map.remove()
    }
  }, [styleUrl])

  useEffect(() => {
    if (mapRef.current) draw(mapRef.current, area, pins)
  }, [area, pins])

  return <div ref={container} className="aspect-square w-full" data-testid="map" />
}
