import { setupWorker } from 'msw/browser'
import { adoptStored, DB_KEY, persist, resetDb } from './db'
import { handlers } from './handlers'
import { signOut } from './session'

const RELOADED = 'mock-reloaded-for-worker'

export async function startMocks(): Promise<void> {
  const worker = setupWorker(...handlers)
  worker.events.on('request:end', persist)
  // Tabs share one emulated backend: what another tab wrote is what this one answers next.
  window.addEventListener('storage', (event) => {
    if (event.key === DB_KEY) adoptStored()
  })
  await worker.start({ quiet: true })
  // A hard reload (Ctrl+Shift+R, «Vaciar caché y volver a cargar») skips every service worker for
  // that page, MSW's included: nothing would answer the API and every screen would say «no pudimos
  // cargar». One normal reload puts the page back under the worker; the flag stops a loop where the
  // browser keeps bypassing it.
  const controlled = Boolean(navigator.serviceWorker?.controller)
  if (controlled) {
    sessionStorage.removeItem(RELOADED)
    return
  }
  if (!sessionStorage.getItem(RELOADED)) {
    sessionStorage.setItem(RELOADED, '1')
    window.location.reload()
    await new Promise(() => undefined)
  }
}

/** «Restablecer la demostración»: the fixtures again, signed out, in every tab. */
export function resetDemo(): void {
  resetDb()
  signOut()
  window.location.assign('/')
}
