// Whether the device says it has a network. Only a hint: `onLine` is true on a captive portal or a
// one-bar signal that drops every request, so a send still treats a failed fetch as "no signal"
// (docs/eng/frontend.md · Risks §6). False, though, is reliable: there is no network to try.

export function isOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false
}

/** Calls back on every change the browser announces; answers the function that stops listening. */
export function watchConnectivity(listener: (online: boolean) => void): () => void {
  if (typeof window === 'undefined') return () => undefined
  const online = () => listener(true)
  const offline = () => listener(false)
  window.addEventListener('online', online)
  window.addEventListener('offline', offline)
  return () => {
    window.removeEventListener('online', online)
    window.removeEventListener('offline', offline)
  }
}
