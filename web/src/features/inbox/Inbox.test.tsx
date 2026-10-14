// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderWithQuery, stubApi } from '../../test-utils'
import { Inbox } from './Inbox'

const HOUR = 3_600_000

const notification = (
  id: string,
  body: string,
  hoursAgo: number,
  read: boolean,
  case_code: string | null = '7K3PQ',
) => ({
  id,
  event: 'sighting.reported',
  body,
  case_code,
  created_at: new Date(Date.now() - hoursAgo * HOUR).toISOString(),
  read_at: read ? new Date(Date.now() - HOUR / 2).toISOString() : null,
})

const inbox = {
  unread_count: 1,
  items: [
    notification('n-1', 'Alguien dice que tiene a Luna. Ábrelo para contactar.', 3, false),
    notification('n-2', 'Tu aviso de Luna ya llegó a los vecinos de la zona.', 48, true),
    notification('n-3', 'Ocultamos tu publicación.', 72, true, null),
  ],
}

function show(answer: { status?: number; body?: unknown }) {
  const calls = stubApi({
    'GET /me/notifications': answer,
    'POST /me/notifications/read': { status: 204 },
  })
  renderWithQuery(<Inbox caseLink={(code, children) => <a href={`/c/${code}`}>{children}</a>} />)
  return calls
}

describe('Inbox', () => {
  it('lists each notification with its time, linking to its case', async () => {
    show({ body: inbox })
    const claim = await screen.findByRole('link', { name: /Alguien dice que tiene a Luna/ })
    expect(claim.getAttribute('href')).toBe('/c/7K3PQ')
    expect(within(claim).getByText('hace 3 h')).toBeTruthy()
    expect(screen.getByText('hace 2 días')).toBeTruthy()
  })

  it('keeps the server’s order: newest first', async () => {
    show({ body: inbox })
    const items = within(await screen.findByRole('list', { name: 'Avisos' })).getAllByRole(
      'listitem',
    )
    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringContaining('tiene a Luna'),
      expect.stringContaining('vecinos'),
      expect.stringContaining('Ocultamos'),
    ])
  })

  it('a notification with no case is not a link', async () => {
    show({ body: inbox })
    expect(await screen.findByText('Ocultamos tu publicación.')).toBeTruthy()
    expect(screen.queryByRole('link', { name: /Ocultamos/ })).toBeNull()
  })

  it('tells the unread apart from the read', async () => {
    show({ body: inbox })
    await screen.findByRole('list', { name: 'Avisos' })
    expect(screen.getAllByText('Sin leer')).toHaveLength(1)
    const unread = screen.getByText(/tiene a Luna/).closest('article')
    const read = screen.getByText(/vecinos/).closest('article')
    expect(unread?.getAttribute('data-unread')).toBe('true')
    expect(read?.getAttribute('data-unread')).toBe('false')
  })

  it('opening it marks the unread ones on screen as read, by id', async () => {
    const calls = show({ body: inbox })
    await waitFor(() =>
      expect(calls.filter((c) => c.key === 'POST /me/notifications/read')).toEqual([
        { key: 'POST /me/notifications/read', body: { ids: ['n-1'] } },
      ]),
    )
    // Still shown as new for the rest of this visit.
    expect(screen.getAllByText('Sin leer')).toHaveLength(1)
  })

  it('marks nothing when everything is already read', async () => {
    const calls = show({ body: { unread_count: 0, items: inbox.items.slice(1) } })
    await screen.findByRole('list', { name: 'Avisos' })
    expect(calls.some((c) => c.key === 'POST /me/notifications/read')).toBe(false)
    expect(screen.queryByText('Sin leer')).toBeNull()
  })

  it('shows a loading state', () => {
    show({ body: inbox })
    expect(screen.getByRole('status', { name: 'Cargando tus avisos' })).toBeTruthy()
  })

  it('has an empty state', async () => {
    show({ body: { unread_count: 0, items: [] } })
    expect(await screen.findByText('Aún no tienes avisos')).toBeTruthy()
  })

  it('has an error state', async () => {
    show({ status: 500 })
    expect(await screen.findByText('No pudimos cargar tus avisos')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeTruthy()
  })
})
