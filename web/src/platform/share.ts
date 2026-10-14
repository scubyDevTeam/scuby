// The device's share sheet, downloads and clipboard (docs/product/10 §4). The only file that asks
// the browser to share; the mobile scope adds its native branch here and nowhere else.

/** What «Compartir» ended up doing: the sheet took it, the person closed it, or the plan B ran. */
export type ShareImageResult =
  | { kind: 'shared' }
  | { kind: 'cancelled' }
  /** No share sheet for files: the image was downloaded, the message copied when the device let us. */
  | { kind: 'saved'; copied: boolean }

const isAbort = (error: unknown) => error instanceof DOMException && error.name === 'AbortError'

/**
 * The share sheet with the image and the message, where the device can share files. Anywhere else
 * — or when the sheet fails for any reason but the person closing it — download + copy.
 */
export async function shareImage({
  file,
  text,
}: {
  file: File
  text: string
}): Promise<ShareImageResult> {
  const data = { files: [file], text }
  if (typeof navigator.share === 'function' && navigator.canShare?.(data)) {
    try {
      await navigator.share(data)
      return { kind: 'shared' }
    } catch (error) {
      if (isAbort(error)) return { kind: 'cancelled' }
    }
  }
  downloadFile(file)
  return { kind: 'saved', copied: await copyText(text) }
}

/** Saves the file through the browser's download, named as the file is. */
export function downloadFile(file: File): void {
  const url = URL.createObjectURL(file)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = file.name
  anchor.rel = 'noopener'
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  // Some browsers read the URL after click() returns: let it live a little.
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

/** True when the text reached the clipboard. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
