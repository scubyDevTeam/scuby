// docs/eng/media-pipeline.md §1: photos are downscaled on the device before upload.
export const MAX_PHOTO_EDGE_PX = 1600
export const PHOTO_JPEG_QUALITY = 0.82

/** The size to draw at: long edge capped, proportions kept, never enlarged. */
export function fitWithin(width: number, height: number, maxEdge = MAX_PHOTO_EDGE_PX) {
  const scale = Math.min(1, maxEdge / Math.max(width, height))
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

/**
 * An iPhone photo in its own format (HEIC/HEIF). Safari reads it; most other browsers cannot, so
 * when it fails to load the person is told what to do instead of «inténtalo de nuevo».
 */
export function isHeic(file: { name: string; type: string }): boolean {
  return /hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name)
}
