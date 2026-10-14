/**
 * Re-encodes a picked photo for upload (docs/eng/media-pipeline.md §1): orientation applied,
 * downscaled, JPEG. Re-encoding through a canvas is also what drops the EXIF (location included).
 */
export async function prepareImage(
  file: Blob,
  size: (width: number, height: number) => { width: number; height: number },
  quality: number,
): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const target = size(bitmap.width, bitmap.height)
  const canvas = document.createElement('canvas')
  canvas.width = target.width
  canvas.height = target.height
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, target.width, target.height)
  bitmap.close()
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the photo'))),
      'image/jpeg',
      quality,
    )
  })
}
