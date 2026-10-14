import { describe, expect, it } from 'vitest'
import { A4_POINTS, jpegToPdf } from './pdf'

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9])
const pdf = jpegToPdf(jpeg, 2480, 3508)
const text = new TextDecoder('latin1').decode(pdf)

describe('jpegToPdf (docs/product/10 §4 · print as PDF)', () => {
  it('is one A4 page showing the image edge to edge', () => {
    expect(text.startsWith('%PDF-1.4\n')).toBe(true)
    expect(text).toContain(`/MediaBox [0 0 ${A4_POINTS.width} ${A4_POINTS.height}]`)
    expect(text).toContain('/Width 2480 /Height 3508')
    expect(text).toContain('/Filter /DCTDecode')
    expect(text).toContain(`q ${A4_POINTS.width} 0 0 ${A4_POINTS.height} 0 0 cm /Im0 Do Q`)
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true)
  })

  it('carries the JPEG bytes untouched', () => {
    const start = text.indexOf('stream\n') + 'stream\n'.length
    expect([...pdf.slice(start, start + jpeg.length)]).toEqual([...jpeg])
  })

  it('points the cross-reference table at every object', () => {
    const startxref = Number(text.match(/startxref\n(\d+)/)?.[1])
    expect(text.slice(startxref, startxref + 4)).toBe('xref')
    const offsets = [...text.matchAll(/^(\d{10}) 00000 n $/gm)].map((match) => Number(match[1]))
    expect(offsets).toHaveLength(5)
    offsets.forEach((offset, index) => {
      expect(text.slice(offset, offset + 8)).toBe(`${index + 1} 0 obj\n`)
    })
  })
})
