import { describe, expect, it } from 'vitest'
import { fitWithin } from './image'

describe('media-pipeline §1 — downscale to 1600 px on the long edge', () => {
  it.each([
    [4032, 3024, 1600, 1200],
    [3024, 4032, 1200, 1600],
    [1600, 900, 1600, 900],
    [800, 600, 800, 600],
  ])('%i×%i → %i×%i', (w, h, outW, outH) => {
    expect(fitWithin(w, h)).toEqual({ width: outW, height: outH })
  })
})
