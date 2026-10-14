// @vitest-environment jsdom

import { queryClient } from '@api-client/query-client'
import { QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { stubApi } from '../test-utils'
import { Route as root } from './__root'
import { LocaleProvider } from './-i18n'

const reportError = vi.hoisted(() => vi.fn())
vi.mock('@platform/errors', () => ({ reportError }))

function Broken(): never {
  throw new Error('render failed for ana@example.com')
}

describe('root error boundary', () => {
  it('shows a calm message with a way out, and reports what broke', async () => {
    stubApi()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const broken = createRoute({ getParentRoute: () => root, path: '/roto', component: Broken })
    const router = createRouter({
      routeTree: root.addChildren([broken]),
      history: createMemoryHistory({ initialEntries: ['/roto'] }),
      InnerWrap: LocaleProvider,
    })
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    )

    expect(await screen.findByRole('heading', { name: 'Algo no salió bien' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Recargar' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Ir al inicio' })).toBeTruthy()
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'render failed for ana@example.com' }),
      expect.stringContaining('Broken'),
    )
  })
})
