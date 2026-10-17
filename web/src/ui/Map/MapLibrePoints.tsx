// Loaded lazily by FeedMap: every case of the feed as GL layers, grouped by vertical where they
// crowd. A group is tapped to zoom into it; a case, to select it. No DOM markers: 300 of them crawl.
import type { Point } from 'geojson'
import { useEffect, useRef } from 'react'
import {
  clusterDiameter,
  clusterIconName,
  markersBounds,
  markersByTone,
  markersKey,
  parseClusterIcon,
  TONES,
} from './geometry'
import { cssColor, type GeoJSONSource, GlMap, type MapGeoJSONFeature } from './maplibre'
import type { MapMarker, MapTone } from './types'

type Props = {
  styleUrl: string
  markers: readonly MapMarker[]
  selectedId: string | null
  /** A case tapped, or `null` when the map itself is tapped. */
  onSelect: (id: string | null) => void
  onError: () => void
}

const toneColor = (tone: MapTone) => cssColor(`--color-${tone}`)

/** A group: its colour, a white ring, a soft halo and its count — drawn once per look. */
function clusterImage(tone: MapTone, count: string): ImageData {
  const size = clusterDiameter(count) * 2
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  const color = toneColor(tone)
  const middle = size / 2
  ctx.globalAlpha = 0.25
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(middle, middle, middle, 0, 2 * Math.PI)
  ctx.fill()
  ctx.globalAlpha = 1
  ctx.beginPath()
  ctx.arc(middle, middle, middle - 14, 0, 2 * Math.PI)
  ctx.fill()
  ctx.lineWidth = 6
  ctx.strokeStyle = '#ffffff'
  ctx.stroke()
  ctx.fillStyle = '#ffffff'
  ctx.font = `bold ${count.length >= 3 ? 34 : 38}px system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(count, middle, middle + 2)
  return ctx.getImageData(0, 0, size, size)
}

const clusterLayer = (tone: MapTone) => `clusters-${tone}`
const caseLayer = (tone: MapTone) => `cases-${tone}`
const selectedLayer = (tone: MapTone) => `selected-${tone}`
const caseLayers = TONES.map(caseLayer)
const clusterLayers = TONES.map(clusterLayer)

export default function MapLibrePoints({
  styleUrl,
  markers,
  selectedId,
  onSelect,
  onError,
}: Props) {
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<GlMap | null>(null)
  const latest = useRef({ markers, selectedId, onSelect, onError })
  latest.current = { markers, selectedId, onSelect, onError }
  const drawnKey = useRef('')

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

    map.on('styleimagemissing', ({ id }) => {
      const cluster = parseClusterIcon(id)
      if (cluster && !map.hasImage(id)) {
        map.addImage(id, clusterImage(cluster.tone, cluster.count), { pixelRatio: 2 })
      }
    })

    map.on('load', () => {
      const byTone = markersByTone(latest.current.markers)
      for (const tone of TONES) {
        map.addSource(tone, {
          type: 'geojson',
          data: byTone[tone],
          cluster: true,
          clusterRadius: 44,
          // Past street level everything is apart: a group that never opens would hide a case.
          clusterMaxZoom: 16,
        })
        map.addLayer({
          id: caseLayer(tone),
          type: 'circle',
          source: tone,
          filter: ['!', ['has', 'point_count']],
          paint: {
            'circle-radius': 11,
            'circle-color': toneColor(tone),
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 3,
          },
        })
        map.addLayer({
          id: selectedLayer(tone),
          type: 'circle',
          source: tone,
          filter: ['==', ['get', 'id'], ''],
          paint: {
            'circle-radius': 16,
            'circle-color': toneColor(tone),
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 5,
          },
        })
        map.addLayer({
          id: clusterLayer(tone),
          type: 'symbol',
          source: tone,
          filter: ['has', 'point_count'],
          layout: {
            'icon-image': ['concat', clusterIconName(tone, ''), ['get', 'point_count_abbreviated']],
            'icon-allow-overlap': true,
          },
        })
      }

      map.on('click', (event) => {
        const [hit] = map.queryRenderedFeatures(event.point, {
          layers: [...clusterLayers, ...caseLayers],
        })
        if (!hit) return latest.current.onSelect(null)
        if (hit.properties.cluster_id !== undefined) return zoomInto(map, hit)
        if (typeof hit.properties.id === 'string') latest.current.onSelect(hit.properties.id)
      })
      for (const layer of [...clusterLayers, ...caseLayers]) {
        map.on('mouseenter', layer, () => {
          map.getCanvas().style.cursor = 'pointer'
        })
        map.on('mouseleave', layer, () => {
          map.getCanvas().style.cursor = ''
        })
      }
      // What is on screen, for the e2e suite: a GL pin has no element to click, only pixels.
      map.on('idle', () => {
        element.dataset.pins = JSON.stringify(onScreen(map))
      })

      mapRef.current = map
      drawnKey.current = markersKey(latest.current.markers)
      fitToMarkers(map, latest.current.markers)
      select(map, latest.current.selectedId)
      element.dataset.mapReady = 'true'
    })

    return () => {
      mapRef.current = null
      map.remove()
    }
  }, [styleUrl])

  useEffect(() => {
    const map = mapRef.current
    const key = markersKey(markers)
    if (!map || key === drawnKey.current) return
    drawnKey.current = key
    const byTone = markersByTone(markers)
    for (const tone of TONES) (map.getSource(tone) as GeoJSONSource).setData(byTone[tone])
    fitToMarkers(map, markers)
  }, [markers])

  useEffect(() => {
    if (mapRef.current) select(mapRef.current, selectedId)
  }, [selectedId])

  return <div ref={container} className="h-full min-h-96 w-full" data-testid="feed-map" />
}

function fitToMarkers(map: GlMap, markers: readonly MapMarker[]) {
  if (markers.length === 0) return
  map.fitBounds(markersBounds(markers), { padding: 56, maxZoom: 15, duration: 0 })
}

function select(map: GlMap, id: string | null) {
  for (const tone of TONES) map.setFilter(selectedLayer(tone), ['==', ['get', 'id'], id ?? ''])
}

/** A tapped group opens: the map zooms to where it splits, centred on it. */
async function zoomInto(map: GlMap, cluster: MapGeoJSONFeature) {
  const source = map.getSource(cluster.source) as GeoJSONSource
  const zoom = await source.getClusterExpansionZoom(cluster.properties.cluster_id as number)
  const [lng, lat] = (cluster.geometry as Point).coordinates as [number, number]
  map.easeTo({ center: [lng, lat], zoom })
}

type OnScreen = { id?: string; count?: number; tone: string; x: number; y: number }

function onScreen(map: GlMap): OnScreen[] {
  const seen = new Set<string>()
  return map
    .queryRenderedFeatures({ layers: [...clusterLayers, ...caseLayers] })
    .filter((feature) => {
      // A feature on a tile edge comes back once per tile.
      const key = `${feature.source}:${feature.properties.cluster_id ?? feature.properties.id}`
      return seen.has(key) ? false : Boolean(seen.add(key))
    })
    .map((feature) => {
      const [lng, lat] = (feature.geometry as Point).coordinates as [number, number]
      const { x, y } = map.project([lng, lat])
      const at = { tone: feature.source, x: Math.round(x), y: Math.round(y) }
      return feature.properties.cluster_id !== undefined
        ? { ...at, count: feature.properties.point_count as number }
        : { ...at, id: feature.properties.id as string }
    })
}
