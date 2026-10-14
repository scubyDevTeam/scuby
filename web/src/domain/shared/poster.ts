// The poster («Afiche») as docs/product/10 §3 defines it: formats, footer per vertical, the print
// QR floor, and the photo framer's crop. Plain numbers in, plain numbers out — the canvas is elsewhere.

export type PosterFormat = 'square' | 'story' | 'print'

/** docs/product/10 §3 · the three formats, in pixels. */
export const POSTER_FORMATS: Record<PosterFormat, { width: number; height: number }> = {
  square: { width: 1080, height: 1080 },
  story: { width: 1080, height: 1920 },
  // A4 portrait at 300 dpi.
  print: { width: 2480, height: 3508 },
}

export const PRINT_DPI = 300
/** On a pole the QR must scan from a step away: never smaller than this when printed. */
export const MIN_PRINT_QR_MM = 30

export const pxToMm = (px: number, dpi = PRINT_DPI) => (px / dpi) * 25.4

/** «Compartir» hands the share sheet the story image: WhatsApp status and Instagram want 9:16. */
export const SHARE_SHEET_FORMAT: PosterFormat = 'story'

export type PosterVertical = 'lost' | 'found' | 'adoption' | 'help'

/** The one line of footer copy per vertical; adoption has none. */
export type PosterFooter = 'no_upfront_money' | 'verify_campaign'

export function posterFooter(vertical: PosterVertical): PosterFooter | null {
  switch (vertical) {
    case 'lost':
    case 'found':
      return 'no_upfront_money'
    case 'help':
      return 'verify_campaign'
    case 'adoption':
      return null
  }
}

// --- The photo framer: zoom slider + drag, kept relative so switching formats keeps the crop ---

/** `zoom` ≥ 1 over a cover fit; `panX`/`panY` in −1…1 of the room the zoom leaves on each axis. */
export type Crop = { zoom: number; panX: number; panY: number }

export const CENTERED: Crop = { zoom: 1, panX: 0, panY: 0 }
export const MAX_ZOOM = 3

type Size = { width: number; height: number }
export type SourceRect = { sx: number; sy: number; sw: number; sh: number }

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export function clampCrop(crop: Crop): Crop {
  return {
    zoom: clamp(crop.zoom, 1, MAX_ZOOM),
    panX: clamp(crop.panX, -1, 1),
    panY: clamp(crop.panY, -1, 1),
  }
}

/** The part of the photo that fills the frame: cover fit, zoomed, then moved within what is left. */
export function cropSource(image: Size, frame: Size, crop: Crop): SourceRect {
  const { zoom, panX, panY } = clampCrop(crop)
  const scale = Math.max(frame.width / image.width, frame.height / image.height) * zoom
  const sw = frame.width / scale
  const sh = frame.height / scale
  const roomX = (image.width - sw) / 2
  const roomY = (image.height - sh) / 2
  return { sx: roomX + panX * roomX, sy: roomY + panY * roomY, sw, sh }
}

/**
 * A drag of (dx, dy) frame pixels: the photo follows the finger, so its visible part moves the
 * other way. A pan with no room on its axis stays where it is.
 */
export function dragCrop(crop: Crop, image: Size, frame: Size, dx: number, dy: number): Crop {
  const { sw, sh } = cropSource(image, frame, crop)
  const scale = frame.width / sw
  const roomX = (image.width - sw) / 2
  const roomY = (image.height - sh) / 2
  return clampCrop({
    zoom: crop.zoom,
    panX: roomX > 0 ? crop.panX - dx / scale / roomX : crop.panX,
    panY: roomY > 0 ? crop.panY - dy / scale / roomY : crop.panY,
  })
}
