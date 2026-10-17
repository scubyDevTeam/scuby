// @vitest-environment jsdom
import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SchematicMap } from './SchematicMap'
import type { MapPin } from './types'

const center = { lat: 6.2447, lng: -75.5916 }
const pin = (id: string, order: number, north: number): MapPin => ({
  id,
  point: { lat: center.lat + north / 110_574, lng: center.lng },
  order,
  band: 'under_24h',
  emphasized: false,
})

describe('SchematicMap', () => {
  it('draws the area, one numbered pin per sighting and the trajectory in order', () => {
    const { container } = render(
      <SchematicMap
        area={{ center, radiusM: 200 }}
        areaLabel="Zona aproximada"
        pins={[pin('b', 2, 300), pin('a', 1, 100)]}
      />,
    )
    const numbers = [...container.querySelectorAll('g text')].map((t) => t.textContent)
    expect(numbers).toEqual(['1', '2'])
    expect(container.querySelectorAll('polyline')).toHaveLength(1)
    expect(container.querySelector('figcaption')?.textContent).toBe('Zona aproximada')
  })

  it('draws no trajectory for a single pin and none for an empty map', () => {
    const one = render(
      <SchematicMap area={{ center, radiusM: 200 }} areaLabel="Zona" pins={[pin('a', 1, 100)]} />,
    )
    expect(one.container.querySelectorAll('polyline')).toHaveLength(0)
    const none = render(<SchematicMap area={{ center, radiusM: 200 }} areaLabel="Zona" pins={[]} />)
    expect(none.container.querySelectorAll('g')).toHaveLength(0)
  })
})

describe('SchematicMap — tapping a pin', () => {
  it('reports which pin was tapped, so the page opens its sheet', () => {
    const onSelectPin = vi.fn()
    const { container } = render(
      <SchematicMap
        area={{ center, radiusM: 200 }}
        areaLabel="Zona"
        pins={[pin('a', 1, 100), pin('b', 2, 300)]}
        onSelectPin={onSelectPin}
      />,
    )
    fireEvent.click(container.querySelector('[data-pin="b"]')!)
    expect(onSelectPin).toHaveBeenCalledWith('b')
  })

  it('names itself with the page’s words only', () => {
    const { container } = render(
      <SchematicMap area={{ center, radiusM: 200 }} areaLabel="Zona" pins={[pin('a', 1, 100)]} />,
    )
    expect(container.querySelector('title')?.textContent).toBe('Zona')
  })
})
