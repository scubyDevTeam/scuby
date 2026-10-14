export type ShareResult = 'shared' | 'copied' | 'cancelled' | 'unavailable'

/** Native share sheet when the browser has one; otherwise the link goes to the clipboard. */
export async function shareLink(link: {
  title: string
  text: string
  url: string
}): Promise<ShareResult> {
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share(link)
      return 'shared'
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled'
    }
  }
  try {
    await navigator.clipboard.writeText(link.url)
    return 'copied'
  } catch {
    return 'unavailable'
  }
}
