// The poster on a canvas (docs/product/10 §3). Generated on the device: the photo, its crop and the
// QR never leave it. Loaded behind the share sheet's lazy boundary, with the QR encoder.
import { type Crop, cropSource, POSTER_FORMATS, type PosterFormat } from '@domain/shared/poster'
import { encode } from 'uqr'
import { fitText, type PosterLayout, posterLayout, type Rect, wrapText } from './layout'
import { type PosterContent, posterFileName } from './model'
import { jpegToPdf } from './pdf'

type Size = { width: number; height: number }

/** A poster ready to draw: fonts, photo, QR and mark loaded once, drawn in any format and crop. */
export type PreparedPoster = {
  /** The photo's pixel size, for the framer's drag; null without a photo. */
  photoSize: Size | null
  /** Draws `format` onto `canvas`, `scale` times its real size (the preview is smaller). */
  draw(canvas: HTMLCanvasElement, format: PosterFormat, crop: Crop, scale: number): void
  /** The full-size file: PNG, or PDF for print. */
  toFile(format: PosterFormat, crop: Crop): Promise<File>
}

export type PreparePoster = (input: {
  content: PosterContent
  markUrl: string
  brandName: string
}) => Promise<PreparedPoster>

type Palette = Record<
  'band' | 'ink' | 'muted' | 'panel' | 'ice' | 'brand' | 'brandDeep' | 'white',
  string
>

// Colours come from the design tokens (src/ui/tokens.css), read where the page has them.
function readPalette(vertical: PosterContent['vertical']): Palette {
  const style = getComputedStyle(document.documentElement)
  const token = (name: string) => style.getPropertyValue(`--color-${name}`).trim()
  const ink = token('ink') || 'black'
  return {
    band: token(vertical) || ink,
    ink,
    muted: token('muted') || ink,
    panel: ink,
    ice: token('brand-ice') || 'white',
    brand: token('brand') || ink,
    brandDeep: token('brand-deep') || ink,
    white: token('surface') || 'white',
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  const image = new Image()
  // Photos come from the media CDN: without CORS the canvas could not be exported.
  image.crossOrigin = 'anonymous'
  image.src = url
  return image.decode().then(() => image)
}

/**
 * A vector photo (an SVG) is rasterised first: canvases disagree on what a source rectangle means
 * for an image without pixels of its own. Photos from the pipeline are JPEGs and pass through.
 */
function withSize(image: HTMLImageElement): HTMLImageElement | HTMLCanvasElement {
  const vector = image.naturalWidth === 0 || /^data:image\/svg|\.svg(\?|$)/.test(image.src)
  if (!vector) return image
  const ratio =
    image.naturalWidth > 0 && image.naturalHeight > 0 ? image.naturalWidth / image.naturalHeight : 1
  const canvas = document.createElement('canvas')
  canvas.width = 1200
  canvas.height = Math.round(1200 / ratio)
  canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height)
  return canvas
}

/** The short link as QR modules: error correction M, the four-module quiet zone included. */
export const qrModules = (url: string) => encode(url, { ecc: 'M', border: 4 }).data

export const preparePoster: PreparePoster = async ({ content, markUrl, brandName }) => {
  // Fonts are the page's own (bundled, never fetched at draw time): wait until they are ready.
  await document.fonts.ready
  const [photo, mark] = await Promise.all([
    content.photoUrl ? loadImage(content.photoUrl).then(withSize) : Promise.resolve(null),
    // The mark is decoration: a poster without it still works, with the name in its place.
    loadImage(markUrl).catch(() => null),
  ])
  const assets: Assets = {
    content,
    photo,
    photoSize:
      photo instanceof HTMLImageElement
        ? { width: photo.naturalWidth, height: photo.naturalHeight }
        : photo && { width: photo.width, height: photo.height },
    mark,
    brandName,
    qr: qrModules(content.link.url),
    palette: readPalette(content.vertical),
    family: getComputedStyle(document.body).fontFamily || 'sans-serif',
  }
  const draw: PreparedPoster['draw'] = (canvas, format, crop, scale) => {
    const { width, height } = POSTER_FORMATS[format]
    canvas.width = Math.round(width * scale)
    canvas.height = Math.round(height * scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas 2d unavailable')
    ctx.scale(scale, scale)
    drawPoster(ctx, posterLayout(format), assets, crop)
  }
  return {
    photoSize: assets.photoSize,
    draw,
    async toFile(format, crop) {
      const canvas = document.createElement('canvas')
      draw(canvas, format, crop, 1)
      const name = posterFileName(content.code, format)
      if (format !== 'print') {
        return new File([await toBlob(canvas, 'image/png')], name, { type: 'image/png' })
      }
      const jpeg = new Uint8Array(await (await toBlob(canvas, 'image/jpeg', 0.9)).arrayBuffer())
      const pdf = jpegToPdf(jpeg, canvas.width, canvas.height)
      return new File([pdf as BlobPart], name, { type: 'application/pdf' })
    },
  }
}

const toBlob = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('canvas export failed'))),
      type,
      quality,
    ),
  )

type Assets = {
  content: PosterContent
  photo: HTMLImageElement | HTMLCanvasElement | null
  photoSize: Size | null
  mark: HTMLImageElement | null
  brandName: string
  qr: boolean[][]
  palette: Palette
  family: string
}

type Ctx = CanvasRenderingContext2D

function font(ctx: Ctx, family: string, weight: number, size: number, spacing = 0) {
  ctx.font = `${weight} ${size}px ${family}`
  // Letter spacing where the canvas has it; the band reads fine without it elsewhere.
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${spacing}px`
}

/** Draws one line of text, shrunk (then ellipsed) to fit `maxWidth`. */
function line(
  ctx: Ctx,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  style: { family: string; weight: number; size: number; color: string; spacing?: number },
) {
  const measure = (value: string, size: number) => {
    font(ctx, style.family, style.weight, size, (style.spacing ?? 0) * size)
    return ctx.measureText(value).width
  }
  const fitted = fitText(measure, text, maxWidth, style.size)
  font(ctx, style.family, style.weight, fitted.size, (style.spacing ?? 0) * fitted.size)
  ctx.fillStyle = style.color
  ctx.fillText(fitted.text, x, y)
}

function drawPoster(ctx: Ctx, layout: PosterLayout, assets: Assets, crop: Crop) {
  const { content, palette, family } = assets
  const { fonts, baselines, pad } = layout
  ctx.textBaseline = 'alphabetic'

  ctx.fillStyle = palette.white
  ctx.fillRect(0, 0, layout.width, layout.height)

  // 1. The label band.
  fill(ctx, layout.band, palette.band)
  ctx.textAlign = 'center'
  line(ctx, content.label, layout.width / 2, baselines.band, layout.width - pad * 2, {
    family,
    weight: 900,
    size: fonts.band,
    color: palette.white,
    spacing: 0.12,
  })

  // 2. The photo, edge to edge — or the paw, never a grey block.
  ctx.textAlign = 'left'
  if (assets.photo && assets.photoSize) {
    const { sx, sy, sw, sh } = cropSource(assets.photoSize, layout.photo, crop)
    const { x, y, width, height } = layout.photo
    ctx.drawImage(assets.photo, sx, sy, sw, sh, x, y, width, height)
  } else {
    drawNoPhoto(ctx, layout, assets)
  }

  // 3. Name, traits, zone and date.
  const textWidth = layout.width - pad * 2
  line(ctx, content.title, pad, baselines.name, textWidth, {
    family,
    weight: 800,
    size: fonts.name,
    color: palette.ink,
  })
  line(ctx, content.traits, pad, baselines.traits, textWidth, {
    family,
    weight: 700,
    size: fonts.traits,
    color: palette.ink,
  })
  line(ctx, content.line, pad, baselines.line, textWidth, {
    family,
    weight: 400,
    size: fonts.line,
    color: palette.muted,
  })

  // 4. The QR panel, on a dark block.
  fill(ctx, layout.panel, palette.panel)
  drawQr(ctx, layout.qr, assets.qr, palette)
  const column = layout.column
  const columnWidth = column.right - column.x
  drawMark(ctx, layout.mark, assets, fonts.scan)
  line(ctx, content.scan, column.x, baselines.scan, layout.mark.x - column.x - pad / 2, {
    family,
    weight: 800,
    size: fonts.scan,
    color: palette.white,
    spacing: 0.08,
  })
  line(ctx, content.link.display, column.x, baselines.link, columnWidth, {
    family: `ui-monospace, Menlo, Consolas, monospace`,
    weight: 700,
    size: fonts.link,
    color: palette.white,
  })
  font(ctx, family, 400, fonts.info)
  ctx.fillStyle = palette.white
  const info = wrapText((value) => ctx.measureText(value).width, content.info, columnWidth, 2)
  info.forEach((text, index) => {
    ctx.fillText(text, column.x, baselines.info + index * fonts.info * 1.3)
  })

  // 5. The footer line.
  if (content.footer) {
    line(ctx, content.footer, pad, baselines.footer, textWidth, {
      family,
      weight: 400,
      size: fonts.footer,
      color: palette.white,
    })
  }
}

function fill(ctx: Ctx, rect: Rect, color: string) {
  ctx.fillStyle = color
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height)
}

function drawQr(ctx: Ctx, rect: Rect, modules: boolean[][], palette: Palette) {
  // White under the whole code, quiet zone included, so it scans on the dark panel.
  fill(ctx, rect, palette.white)
  const count = modules.length
  const edge = (index: number, origin: number) => Math.round(origin + (index * rect.width) / count)
  ctx.fillStyle = palette.ink
  modules.forEach((row, r) => {
    row.forEach((dark, c) => {
      if (!dark) return
      const x = edge(c, rect.x)
      const y = edge(r, rect.y)
      ctx.fillRect(x, y, edge(c + 1, rect.x) - x, edge(r + 1, rect.y) - y)
    })
  })
}

function drawMark(ctx: Ctx, rect: Rect, assets: Assets, size: number) {
  if (assets.mark) {
    ctx.drawImage(assets.mark, rect.x, rect.y, rect.width, rect.height)
    return
  }
  ctx.textAlign = 'right'
  line(ctx, assets.brandName, rect.x + rect.width, rect.y + size, rect.width * 4, {
    family: assets.family,
    weight: 800,
    size,
    color: assets.palette.white,
  })
  ctx.textAlign = 'left'
}

function drawNoPhoto(ctx: Ctx, layout: PosterLayout, assets: Assets) {
  const { photo } = layout
  fill(ctx, photo, assets.palette.ice)
  const unit = Math.min(photo.width, photo.height) / 400
  const cx = photo.x + photo.width / 2
  const cy = photo.y + photo.height / 2 - 40 * unit
  ctx.fillStyle = assets.palette.brand
  const pad = (x: number, y: number, rx: number, ry: number) => {
    ctx.beginPath()
    ctx.ellipse(cx + x * unit, cy + y * unit, rx * unit, ry * unit, 0, 0, Math.PI * 2)
    ctx.fill()
  }
  pad(0, 45, 62, 52)
  pad(-82, -22, 26, 34)
  pad(-30, -72, 26, 36)
  pad(30, -72, 26, 36)
  pad(82, -22, 26, 34)
  ctx.textAlign = 'center'
  line(ctx, assets.content.noPhoto, cx, cy + 150 * unit, photo.width - layout.pad * 2, {
    family: assets.family,
    weight: 700,
    size: layout.fonts.traits,
    color: assets.palette.brandDeep,
  })
  ctx.textAlign = 'left'
}
