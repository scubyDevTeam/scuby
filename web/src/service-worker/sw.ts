// The app's service worker (docs/eng/frontend.md · What the frontend owns, Offline-ish; Push).
// Built by vite-plugin-pwa (injectManifest); registered by main.tsx only against a real backend.
import { call } from '@api-client/http'
import { parseCreated } from '@contracts/actions'
import { api } from '@contracts/api'
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { answerFor, type NotificationData, notificationFor, parsePayload } from './push'

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: (string | { url: string; revision: string | null })[]
}

// The shell (index.html, the app's JS and CSS, icons, fonts) — the list is the build's.
precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()
// Every route is the single page: a link opened offline still gets the shell.
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')))

self.addEventListener('push', (event) => {
  const payload = parsePayload(json(event.data))
  if (!payload) return
  event.waitUntil(
    self.registration.showNotification(
      payload.title,
      notificationFor(payload, '/brand/icon-192.png'),
    ),
  )
})

function json(data: PushMessageData | null): unknown {
  try {
    return data?.json() ?? null
  } catch {
    return null
  }
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(tapped(event.notification.data as NotificationData, event.action))
})

/** A button answers the check-in where it stands; if that fails, or it was the body, open the case. */
async function tapped(data: NotificationData, action: string): Promise<void> {
  const answer = answerFor(data, action)
  if (answer) {
    try {
      await call(
        api.answerCheckin,
        {
          params: { code: answer.code, checkinId: answer.checkinId },
          body: { response: answer.response },
        },
        parseCreated,
      )
      return
    } catch {
      // No session on this browser, or no network: the case page asks the same question.
    }
  }
  await open(data.url)
}

async function open(path: string): Promise<void> {
  const url = new URL(path, self.location.origin).href
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  const same = windows.find((client) => client.url === url)
  if (same) {
    await same.focus()
    return
  }
  await self.clients.openWindow(url)
}
