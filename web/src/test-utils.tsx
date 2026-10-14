// Shared by component tests: a fresh query cache and a fake API answered from a route table.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { vi } from 'vitest'

export function renderWithQuery(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

export const colombia = {
  supported_countries: [
    {
      code: 'CO',
      phone_prefix: '+57',
      mobile_pattern: '^3\\d{9}$',
      default_center: { lat: 6.2442, lng: -75.5812 },
    },
  ],
}

type Answer = { status?: number; body?: unknown }

/**
 * Answers `fetch` by «METHOD /path». `/config` is always there. Returns the calls made, with their
 * JSON bodies, so a test can assert what was sent.
 */
export function stubApi(routes: Record<string, Answer | (() => Answer)> = {}) {
  const calls: { key: string; body: unknown }[] = []
  const all: typeof routes = { 'GET /config': { body: colombia }, ...routes }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: URL, init?: RequestInit) => {
      const key = `${init?.method ?? 'GET'} ${url.pathname}`
      // Uploads send a form, not JSON: there is nothing to read back from them.
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
      calls.push({ key, body })
      const route = all[key]
      if (!route) return new Response(null, { status: 404 })
      const answer = typeof route === 'function' ? route() : route
      const status = answer.status ?? 200
      // A 204 cannot carry a body, not even an empty one.
      return new Response(status === 204 ? null : JSON.stringify(answer.body ?? {}), { status })
    }),
  )
  return calls
}
