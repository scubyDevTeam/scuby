// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { feedItems } from '../../mocks/fixtures'
import { FeedPage } from './FeedPage'

const CENTER = { lat: 6.2442, lng: -75.5812 }
const config = () =>
  new Response(
    JSON.stringify({
      supported_countries: [
        { code: 'CO', phone_prefix: '+57', mobile_pattern: '^3\\d{9}$', default_center: CENTER },
      ],
    }),
    { status: 200 },
  )

/** Answers `/config` itself; `respond` answers the feed. Returns the feed's calls only. */
function show(respond: (url: URL) => Response) {
  const feedCalls = vi.fn((url: URL) => respond(url))
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: URL) => (url.pathname.endsWith('/config') ? config() : feedCalls(url))),
  )
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <FeedPage
        brandName="Marca"
        brandMarkUrl="/mark.png"
        mapStyleUrl={undefined}
        caseLink={(code, children) => <a href={`/c/${code}`}>{children}</a>}
      />
    </QueryClientProvider>,
  )
  return feedCalls
}

/** The browser says the person already allowed their location, at `position`. */
function allowLocation(position: { lat: number; lng: number }) {
  vi.stubGlobal('navigator', {
    ...navigator,
    permissions: { query: async () => ({ state: 'granted' }) },
    geolocation: {
      getCurrentPosition: (ok: (p: { coords: { latitude: number; longitude: number } }) => void) =>
        ok({ coords: { latitude: position.lat, longitude: position.lng } }),
    },
  })
}

const feed = (scope: 'local' | 'national', items = feedItems()) =>
  new Response(JSON.stringify({ scope, items }), { status: 200 })

describe('FeedPage', () => {
  it('shows a card per case, each linking to its page', async () => {
    show(() => feed('local'))

    expect(await screen.findAllByRole('article')).toHaveLength(feedItems().length)
    expect(screen.getByRole('heading', { name: 'Cerca de ti, ahora' })).toBeTruthy()
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
      expect(last?.searchParams.get('vertical')).toBe('lost')
      expect(last?.searchParams.get('species')).toBe('cat')
    })
  })

  // Decision #41: the feed is nearest first around a point; without one it is national for everyone.
  it('asks around the country’s default center when the location was not allowed', async () => {
    const fetchMock = show(() => feed('local'))
    await screen.findAllByRole('article')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const url = fetchMock.mock.calls[0]?.[0]
    expect(url?.searchParams.get('lat')).toBe(String(CENTER.lat))
    expect(url?.searchParams.get('lng')).toBe(String(CENTER.lng))
  })

  it('asks around the device when the location was already allowed, without prompting', async () => {
    allowLocation({ lat: 4.711, lng: -74.0721 })
    const fetchMock = show(() => feed('local'))
    await screen.findAllByRole('article')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const url = fetchMock.mock.calls[0]?.[0]
    expect(url?.searchParams.get('lat')).toBe('4.711')
    expect(url?.searchParams.get('lng')).toBe('-74.0721')
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
