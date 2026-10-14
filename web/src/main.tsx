import { queryClient } from '@api-client/query-client'
import { startErrorReporting } from '@platform/errors'
import { QueryClientProvider } from '@tanstack/react-query'
import { createRouter, RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { API_MOCK } from './env'
import { LocaleProvider } from './routes/-i18n'
import { routeTree } from './routeTree.gen'
import '@ui/tokens.css'

// The provider sits inside the router: the language is read from the URL.
const router = createRouter({ routeTree, defaultPreload: 'intent', InnerWrap: LocaleProvider })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

// The app's service worker (shell cache + push: src/service-worker/sw.ts) — never next to the
// emulated backend. MSW's worker (public/mockServiceWorker.js) holds scope '/', and a scope has one
// service worker: registering ours would replace it and the mocked API would stop answering. So
// with VITE_API_MOCK (dev, the e2e run, demos) there is no app worker: no offline shell, and push
// subscribes through MSW's registration, which shows nothing.
function registerAppWorker() {
  if (!('serviceWorker' in navigator)) return
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined)
  })
}

async function start() {
  if (API_MOCK) {
    const { startMocks } = await import('@mocks/browser')
    await startMocks()
  } else {
    registerAppWorker()
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </StrictMode>,
  )
}

// Listening before anything renders; the SDK itself arrives after the first paint (platform/errors).
void startErrorReporting()
start()
