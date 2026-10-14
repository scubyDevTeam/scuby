// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { feedItems } from '../../mocks/fixtures'
import { FeedPage } from './FeedPage'

function show(respond: (url: URL) => Response) {
  const fetchMock = vi.fn(async (url: URL) => respond(url))
  vi.stubGlobal('fetch', fetchMock)
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <FeedPage
        brandName="Marca"
        caseLink={(code, children) => <a href={`/c/${code}`}>{children}</a>}
      />
    </QueryClientProvider>,
  )
  return fetchMock
}

const feed = (scope: 'local' | 'national', items = feedItems()) =>
  new Response(JSON.stringify({ scope, items }), { status: 200 })

describe('FeedPage', () => {
  it('shows a card per case, each linking to its page', async () => {
    show(() => feed('local'))

    expect(await screen.findByRole('heading', { name: 'Cerca de ti, ahora' })).toBeTruthy()
    expect(screen.getAllByRole('article')).toHaveLength(5)
    expect(screen.getByRole('link', { name: /Luna/ }).getAttribute('href')).toBe('/c/7K3PQ')
  })

  it('shows the name from configuration, never a literal', async () => {
    show(() => feed('local'))
    expect(await screen.findByText('Marca')).toBeTruthy()
  })

  it('asks the API again with the chosen filters', async () => {
    const fetchMock = show(() => feed('local'))
    await screen.findAllByRole('article')

    fireEvent.click(screen.getByRole('button', { name: 'Perdidos' }))
    fireEvent.click(screen.getByRole('button', { name: 'Gatos' }))

    await waitFor(() => {
      const last = fetchMock.mock.calls.at(-1)?.[0]
      expect(last?.search).toBe('?vertical=lost&species=cat')
    })
  })

  it('says so when the feed fell back to the whole country (00 · Geography)', async () => {
    show(() => feed('national'))
    expect(await screen.findByRole('heading', { name: 'En todo el país' })).toBeTruthy()
  })

  it('has an empty state', async () => {
    show(() => feed('local', []))
    expect(await screen.findByText('No hay avisos con ese filtro')).toBeTruthy()
  })

  it('has an error state that can retry', async () => {
    const fetchMock = show(() => new Response(null, { status: 500 }))
    fireEvent.click(await screen.findByRole('button', { name: 'Reintentar' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  })
})
