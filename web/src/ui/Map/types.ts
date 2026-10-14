// The map's whole interface (frontend.md · Rule 5): props in, nothing else.
export type MapPoint = { lat: number; lng: number }
export type MapArea = { center: MapPoint; radiusM: number }
export type AgeBand = 'under_6h' | 'under_24h' | 'under_3d' | 'older'

export type MapPin = {
  id: string
  point: MapPoint
  /** ①②③ from the oldest. */
  order: number
  band: AgeBand
  /** Full size whatever its age: the newest pin, or one the owner starred. */
  emphasized: boolean
  /** «hace 2 h» on the newest pin. */
  label?: string
}

/** A case on the feed map, coloured by its vertical. */
export type MapMarker = {
  id: string
  point: MapPoint
  tone: 'lost' | 'found' | 'adoption' | 'help'
}
