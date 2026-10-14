/** Hands the user to another app or site (WhatsApp) without leaving ours. */
export function openExternal(url: string): void {
  window.open(url, '_blank', 'noopener')
}
