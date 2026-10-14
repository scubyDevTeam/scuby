// A tile-less drawing of the same things the real map will show: the last-seen area, the sighting
// pins and the trajectory line. It is what renders until MapLibre lands behind this folder
// (frontend-plan phase 3) and whenever no tile key is configured.
import type { AgeBand, MapArea, MapPin, MapPoint } from './types'

const SIZE = 320
const PADDING = 36

const bandStyle: Record<AgeBand, { r: number; opacity: number }> = {
  under_6h: { r: 13, opacity: 1 },
  under_24h: { r: 11, opacity: 0.8 },
  under_3d: { r: 10, opacity: 0.6 },
  older: { r: 9, opacity: 0.45 },
}

/** Local flat projection in metres around the area's center: fine at neighbourhood scale. */
function metres(origin: MapPoint, point: MapPoint) {
  const x = (point.lng - origin.lng) * 111_320 * Math.cos((origin.lat * Math.PI) / 180)
  const y = (point.lat - origin.lat) * 110_574
  return { x, y }
}

export function SchematicMap({
  area,
  areaLabel,
  pins,
}: {
  area: MapArea
  areaLabel: string
  pins: readonly MapPin[]
}) {
  const local = pins.map((pin) => ({ pin, ...metres(area.center, pin.point) }))
  const reach = Math.max(area.radiusM, ...local.map((p) => Math.max(Math.abs(p.x), Math.abs(p.y))))
  const scale = (SIZE / 2 - PADDING) / reach
  const px = (x: number) => SIZE / 2 + x * scale
  const py = (y: number) => SIZE / 2 - y * scale
  const ordered = [...local].sort((a, b) => a.pin.order - b.pin.order)

  return (
    <figure className="m-0 overflow-hidden rounded-2xl bg-soft">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="block w-full" role="img">
        <title>{`${areaLabel}. ${pins.length} avistamientos.`}</title>
        <circle
          cx={px(0)}
          cy={py(0)}
          r={area.radiusM * scale}
          className="fill-lost/15 stroke-lost"
          strokeWidth="2"
          strokeDasharray="6 5"
        />
        {ordered.length > 1 ? (
          <polyline
            points={ordered.map((p) => `${px(p.x)},${py(p.y)}`).join(' ')}
            className="fill-none stroke-ink"
            strokeWidth="2.5"
            strokeDasharray="2 7"
            strokeLinecap="round"
          />
        ) : null}
        {ordered.map(({ pin, x, y }) => {
          const style = pin.emphasized ? { r: 16, opacity: 1 } : bandStyle[pin.band]
          return (
            <g key={pin.id} opacity={style.opacity}>
              <circle
                cx={px(x)}
                cy={py(y)}
                r={style.r}
                className={
                  pin.emphasized ? 'fill-brand stroke-white' : 'fill-brand-ice stroke-brand'
                }
                strokeWidth="3"
              />
              <text
                x={px(x)}
                y={py(y)}
                textAnchor="middle"
                dominantBaseline="central"
                className={`text-[13px] font-bold ${pin.emphasized ? 'fill-white' : 'fill-brand-deep'}`}
              >
                {pin.order}
              </text>
              {pin.label ? (
                <text
                  x={px(x)}
                  y={py(y) - style.r - 8}
                  textAnchor="middle"
                  className="fill-brand-deep text-[12px] font-bold"
                >
                  {pin.label}
                </text>
              ) : null}
            </g>
          )
        })}
      </svg>
      <figcaption className="px-4 pb-3 text-sm font-semibold text-lost-ink">{areaLabel}</figcaption>
    </figure>
  )
}
