// The only module that imports MapLibre (frontend.md · Rule 5); reached through lazy imports only.
import { setWorkerUrl } from 'maplibre-gl'
// The library resolves its worker at runtime; the bundler has to be told to build and serve it.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import 'maplibre-gl/dist/maplibre-gl.css'

setWorkerUrl(workerUrl)

export { type GeoJSONSource, Map as GlMap } from 'maplibre-gl'

export const cssColor = (name: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim()
