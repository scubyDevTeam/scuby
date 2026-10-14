import { queryClient } from '@api-client/query-client'
import { QueryClientProvider } from '@tanstack/react-query'
import { createRouter, RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { env } from './env'
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

async function start() {
  if (env.apiMock) {
    const { startMocks } = await import('@mocks/browser')
    await startMocks()
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </StrictMode>,
  )
}

start()
