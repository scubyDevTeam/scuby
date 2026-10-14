import { MIN_PRINT_QR_MM, type PosterFormat, pxToMm } from '@domain/shared/poster'
import { describe, expect, it } from 'vitest'
import { fitText, posterLayout, wrapText } from './layout'

const FORMATS: PosterFormat[] = ['square', 'story', 'print']

describe('posterLayout (docs/product/10 §3 · Layout, top to bottom)', () => {
  it.each(FORMATS)('%s: band, photo, text and QR panel stack with no gap or overlap', (format) => {
    const layout = posterLayout(format)
    const blocks = [layout.band, layout.photo, layout.text, layout.panel]
    expect(blocks[0]?.y).toBe(0)
    for (const [index, block] of blocks.entries()) {
      expect(block.width).toBe(layout.width)
      const next = blocks[index + 1]
      if (next) expect(next.y).toBe(block.y + block.height)
    }
    expect(layout.panel.y + layout.panel.height).toBe(layout.height)
  })

  it.each(FORMATS)(
    '%s: the photo is the biggest block — on a pole, it is the message',
    (format) => {
      const { band, photo, text, panel } = posterLayout(format)
      expect(photo.height).toBeGreaterThan(Math.max(band.height, text.height, panel.height))
    },
  )

  it.each(FORMATS)(
    '%s: name, traits and zone line sit inside the text block, in order',
    (format) => {
      const { text, baselines } = posterLayout(format)
      expect(baselines.name).toBeGreaterThan(text.y)
      expect(baselines.traits).toBeGreaterThan(baselines.name)
      expect(baselines.line).toBeGreaterThan(baselines.traits)
      expect(baselines.line).toBeLessThan(text.y + text.height)
    },
  )

  it.each(FORMATS)('%s: the QR and its text fit the dark panel', (format) => {
    const { panel, qr, column, baselines, fonts } = posterLayout(format)
    expect(qr.width).toBe(qr.height)
    expect(qr.y).toBeGreaterThan(panel.y)
    expect(qr.y + qr.height).toBeLessThan(panel.y + panel.height)
    expect(column.x).toBeGreaterThan(qr.x + qr.width)
    expect(column.right - column.x).toBeGreaterThan(qr.width)
    expect(baselines.info + fonts.info * 1.3).toBeLessThan(qr.y + qr.height + fonts.info)
    expect(baselines.footer).toBeLessThan(panel.y + panel.height)
  })

  it('print: the QR is at least 30 mm on paper', () => {
    expect(pxToMm(posterLayout('print').qr.width)).toBeGreaterThanOrEqual(MIN_PRINT_QR_MM)
  })
})

// A fake font: every character is `size / 2` wide.
const measure = (text: string, size: number) => (text.length * size) / 2

describe('fitText', () => {
  it('keeps the size when the text fits', () => {
    expect(fitText(measure, 'Luna', 1000, 100)).toEqual({ text: 'Luna', size: 100 })
  })

  it('shrinks a long name until it fits', () => {
    const fitted = fitText(measure, 'Mantequilla', 400, 100)
    expect(fitted.text).toBe('Mantequilla')
    expect(measure(fitted.text, fitted.size)).toBeLessThanOrEqual(400)
  })

  it('ellipses what does not fit even at the smallest size', () => {
    const fitted = fitText(
      measure,
      'Se perdió en Laureles · 2 de octubre · hace 3 días',
      300,
      40,
      30,
    )
    expect(fitted.size).toBe(30)
    expect(fitted.text.endsWith('…')).toBe(true)
    expect(measure(fitted.text, 30)).toBeLessThanOrEqual(300)
  })
})

describe('wrapText', () => {
  const width = (text: string) => text.length * 10

  it('breaks between words', () => {
    expect(wrapText(width, 'Información al día y contacto directo', 200, 2)).toEqual([
      'Información al día y',
      'contacto directo',
    ])
  })

  it('ellipses the last line allowed', () => {
    const lines = wrapText(width, 'uno dos tres cuatro cinco seis siete ocho', 100, 2)
    expect(lines).toHaveLength(2)
    expect(lines[1]?.endsWith('…')).toBe(true)
    expect(width(lines[1] ?? '')).toBeLessThanOrEqual(100)
  })
})
