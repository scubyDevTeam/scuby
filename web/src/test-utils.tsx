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
  supported_countries: [{ code: 'CO', phone_prefix: '+57', mobile_pattern: '^3\\d{9}$' }],
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
      calls.push({ key, body: init?.body ? JSON.parse(String(init.body)) : undefined })
      const route = all[key]
      if (!route) return new Response(null, { status: 404 })
      const answer = typeof route === 'function' ? route() : route
      return new Response(JSON.stringify(answer.body ?? {}), { status: answer.status ?? 200 })
    }),
  )
  return calls
}
