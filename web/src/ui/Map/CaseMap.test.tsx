// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CaseMap } from './CaseMap'

describe('CaseMap', () => {
  it('falls back to the tile-less drawing when no tile style is configured', () => {
    render(
      <CaseMap
        styleUrl={undefined}
        area={{ center: { lat: 6.2447, lng: -75.5916 }, radiusM: 200 }}
        areaLabel="Zona aproximada"
        pins={[]}
      />,
    )
    expect(screen.getByRole('img')).toBeTruthy()
    expect(screen.queryByTestId('map')).toBeNull()
  })
})
