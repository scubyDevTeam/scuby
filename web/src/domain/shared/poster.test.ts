import { describe, expect, it } from 'vitest'
import {
  CENTERED,
  clampCrop,
  cropSource,
  dragCrop,
  MAX_ZOOM,
  POSTER_FORMATS,
  posterFooter,
  pxToMm,
  SHARE_SHEET_FORMAT,
} from './poster'

describe('docs/product/10 §3 · the three formats', () => {
  it('square 1080×1080, story 1080×1920, print A4 portrait at 300 dpi', () => {
    expect(POSTER_FORMATS.square).toEqual({ width: 1080, height: 1080 })
    expect(POSTER_FORMATS.story).toEqual({ width: 1080, height: 1920 })
    expect(POSTER_FORMATS.print).toEqual({ width: 2480, height: 3508 })
    // 2480 px at 300 dpi is 210 mm: A4's width.
    expect(Math.round(pxToMm(POSTER_FORMATS.print.width))).toBe(210)
    expect(Math.round(pxToMm(POSTER_FORMATS.print.height))).toBe(297)
  })

  it('§4 · «Compartir» sends the 9:16 story image', () => {
    expect(SHARE_SHEET_FORMAT).toBe('story')
  })
})

describe('docs/product/10 §3 · Layout 5: one line of footer copy per vertical', () => {
  it.each([
    ['lost', 'no_upfront_money'],
    ['found', 'no_upfront_money'],
    ['adoption', null],
    ['help', null],
  ] as const)('%s → %s', (vertical, footer) => {
    expect(posterFooter(vertical)).toBe(footer)
  })
})

describe('docs/product/10 §3 · Layout 2: the photo framer', () => {
  const landscape = { width: 1600, height: 1200 }
  const square = { width: 1000, height: 1000 }

  it('centred, it covers the frame with the middle of the photo', () => {
    expect(cropSource(landscape, square, CENTERED)).toEqual({ sx: 200, sy: 0, sw: 1200, sh: 1200 })
  })

  it('zoom shows a smaller part, still centred', () => {
    expect(cropSource(landscape, square, { ...CENTERED, zoom: 2 })).toEqual({
      sx: 500,
      sy: 300,
      sw: 600,
      sh: 600,
    })
  })

  it('the crop is relative, so switching formats keeps what is in view', () => {
    const crop = { zoom: 1.5, panX: 0.5, panY: -0.5 }
    const wide = cropSource(landscape, { width: 1080, height: 450 }, crop)
    const tall = cropSource(landscape, { width: 1080, height: 900 }, crop)
    const centre = (r: typeof wide) => [r.sx + r.sw / 2, r.sy + r.sh / 2]
    // Both views lean the same way from the photo's centre (800, 600): right and up.
    for (const [x, y] of [centre(wide), centre(tall)]) {
      expect(x).toBeGreaterThan(800)
      expect(y).toBeLessThan(600)
    }
  })

  it('never shows outside the photo, whatever the slider and the finger did', () => {
    expect(clampCrop({ zoom: 9, panX: 4, panY: -4 })).toEqual({ zoom: MAX_ZOOM, panX: 1, panY: -1 })
    expect(clampCrop({ zoom: 0.2, panX: 0, panY: 0 }).zoom).toBe(1)
    const { sx, sy, sw, sh } = cropSource(landscape, square, { zoom: 2, panX: 1, panY: 1 })
    expect(sx + sw).toBe(landscape.width)
    expect(sy + sh).toBe(landscape.height)
  })

  it('a drag moves the photo with the finger', () => {
    // Finger to the right: the photo follows, so its left part comes into view.
    const moved = dragCrop(CENTERED, landscape, square, 100, 0)
    expect(moved.panX).toBeLessThan(0)
    expect(cropSource(landscape, square, moved).sx).toBeLessThan(200)
  })

  it('an axis with no room does not move', () => {
    // Centred cover of a landscape photo in a square: the full height is in view.
    expect(dragCrop(CENTERED, landscape, square, 0, 300).panY).toBe(0)
  })

  it('«Centrar de nuevo» is the centred crop', () => {
    expect(CENTERED).toEqual({ zoom: 1, panX: 0, panY: 0 })
  })
})
