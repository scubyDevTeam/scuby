// Where every part of the poster sits, per format (docs/product/10 §3 · Layout, top to bottom).
// Pure geometry: the canvas code reads these rectangles and sizes and draws nothing it computes.
import { POSTER_FORMATS, type PosterFormat } from '@domain/shared/poster'

export type Rect = { x: number; y: number; width: number; height: number }

type Spec = {
  /** Block heights and paddings, in units of width / 1080. */
  band: number
  text: number
  panel: number
  pad: number
  panelPad: number
  footer: number
  fonts: {
    band: number
    name: number
    traits: number
    line: number
    scan: number
    link: number
    info: number
    footer: number
  }
}

// The photo takes what the other blocks leave: on a pole, the photo is the message.
const SPECS: Record<PosterFormat, Spec> = {
  square: {
    band: 130,
    text: 230,
    panel: 270,
    pad: 48,
    panelPad: 32,
    footer: 44,
    fonts: { band: 72, name: 84, traits: 36, line: 30, scan: 24, link: 36, info: 24, footer: 22 },
  },
  story: {
    band: 220,
    text: 360,
    panel: 440,
    pad: 56,
    panelPad: 48,
    footer: 56,
    fonts: { band: 104, name: 120, traits: 48, line: 40, scan: 30, link: 46, info: 32, footer: 28 },
  },
  print: {
    band: 200,
    text: 330,
    panel: 400,
    pad: 56,
    panelPad: 44,
    footer: 56,
    fonts: { band: 100, name: 116, traits: 46, line: 38, scan: 30, link: 46, info: 32, footer: 28 },
  },
}

export type PosterLayout = {
  format: PosterFormat
  width: number
  height: number
  band: Rect
  photo: Rect
  text: Rect
  /** The dark block where one acts: QR, the link in text, the footer line. */
  panel: Rect
  qr: Rect
  /** Left edge and right bound of the column beside the QR. */
  column: { x: number; right: number }
  mark: Rect
  /** Side padding of the text block. */
  pad: number
  /** Baselines, top to bottom. */
  baselines: {
    band: number
    name: number
    traits: number
    line: number
    scan: number
    link: number
    info: number
    footer: number
  }
  fonts: Spec['fonts']
}

export function posterLayout(format: PosterFormat): PosterLayout {
  const { width, height } = POSTER_FORMATS[format]
  const spec = SPECS[format]
  const u = width / 1080
  const px = (units: number) => Math.round(units * u)

  const band = { x: 0, y: 0, width, height: px(spec.band) }
  const panelHeight = px(spec.panel)
  const textHeight = px(spec.text)
  const panel = { x: 0, y: height - panelHeight, width, height: panelHeight }
  const text = { x: 0, y: panel.y - textHeight, width, height: textHeight }
  const photo = { x: 0, y: band.height, width, height: text.y - band.height }

  const fonts = Object.fromEntries(
    Object.entries(spec.fonts).map(([key, size]) => [key, px(size)]),
  ) as Spec['fonts']

  // Name, traits and the zone line, centred as one group in their block.
  const group = fonts.name + fonts.traits * 1.5 + fonts.line * 1.6
  const top = text.y + (text.height - group) / 2
  const name = top + fonts.name * 0.85
  const traits = name + fonts.traits * 1.5
  const line = traits + fonts.line * 1.6

  const qrSize = panel.height - px(spec.panelPad) * 2 - px(spec.footer)
  const qr = { x: px(spec.pad), y: panel.y + px(spec.panelPad), width: qrSize, height: qrSize }
  const column = { x: qr.x + qr.width + px(36), right: width - px(spec.pad) }
  const markHeight = px(48)
  // The mark file is 147 × 160.
  const markWidth = Math.round((markHeight * 147) / 160)
  const mark = { x: column.right - markWidth, y: qr.y, width: markWidth, height: markHeight }
  const scan = qr.y + fonts.scan * 1.1

  return {
    format,
    width,
    height,
    band,
    photo,
    text,
    panel,
    qr,
    column,
    mark,
    pad: px(spec.pad),
    baselines: {
      band: band.height / 2 + fonts.band * 0.36,
      name,
      traits,
      line,
      scan,
      link: scan + fonts.link * 1.5,
      info: scan + fonts.link * 1.5 + fonts.info * 1.6,
      footer: qr.y + qr.height + px(spec.footer) * 0.75,
    },
    fonts,
  }
}

/** The biggest size, down to `min`, at which `text` fits `maxWidth`; past that, an ellipsis. */
export function fitText(
  measure: (text: string, size: number) => number,
  text: string,
  maxWidth: number,
  size: number,
  min = Math.round(size * 0.6),
): { text: string; size: number } {
  for (let current = size; current >= min; current -= 1) {
    if (measure(text, current) <= maxWidth) return { text, size: current }
  }
  let cut = text
  while (cut.length > 1 && measure(`${cut}…`, min) > maxWidth) cut = cut.slice(0, -1)
  return { text: `${cut.trimEnd()}…`, size: min }
}

/** Splits `text` into at most `maxLines` lines that fit, the last one ellipsed if it must be. */
export function wrapText(
  measure: (text: string) => number,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const lines: string[] = []
  let current = ''
  const words = text.split(/\s+/).filter(Boolean)
  for (const [index, word] of words.entries()) {
    const next = current ? `${current} ${word}` : word
    if (measure(next) <= maxWidth || !current) {
      current = next
      continue
    }
    if (lines.length === maxLines - 1) {
      let rest = `${current} ${words.slice(index).join(' ')}`
      while (rest.length > 1 && measure(`${rest}…`) > maxWidth) rest = rest.slice(0, -1)
      lines.push(`${rest.trimEnd()}…`)
      return lines
    }
    lines.push(current)
    current = word
  }
  if (current) lines.push(current)
  return lines
}
