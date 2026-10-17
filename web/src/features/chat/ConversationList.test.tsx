// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { listAnswer } from '../../mocks/chat-wire'
import { renderWithQuery, stubApi } from '../../test-utils'
import { ConversationList } from './ConversationList'

function show(answer: { status?: number; body?: unknown }) {
  stubApi({ 'GET /me/conversations': answer })
  renderWithQuery(
    <ConversationList threadLink={(id, children) => <a href={`/mensajes/${id}`}>{children}</a>} />,
  )
}

describe('ConversationList — the «Mensajes» tab', () => {
  it('lists each thread with who, why, the last words and when, linking to it', async () => {
    show({ body: listAnswer })
    const row = await screen.findByRole('link', { name: /Andrés R\./ })
    expect(row.getAttribute('href')).toBe('/mensajes/c-1')
    expect(within(row).getByText('Gatito negro · reclamo «Es mío»')).toBeTruthy()
    expect(within(row).getByText('Tiene unas canas blancas en el pecho')).toBeTruthy()
    expect(within(row).getByText('hace 12 min')).toBeTruthy()
  })

  it('counts what is unread, spoken, and leaves the read ones without a count', async () => {
    show({ body: listAnswer })
    const unread = await screen.findByRole('link', { name: /Andrés R\./ })
    expect(within(unread).getByText('2 mensajes sin leer')).toBeTruthy()
    const read = screen.getByRole('link', { name: /Marta G\./ })
    expect(within(read).queryByText(/sin leer/)).toBeNull()
  })

  it('says «Cerrado» on a thread whose case ended, and keeps the server’s order', async () => {
    show({ body: listAnswer })
    const items = within(await screen.findByRole('list', { name: 'Conversaciones' })).getAllByRole(
      'listitem',
    )
    expect(items[1]?.textContent).toContain('Cerrado')
    expect(items[0]?.textContent).not.toContain('Cerrado')
  })

  it('with no threads says where they will appear and that the number stays hidden', async () => {
    show({ body: { unread_count: 0, items: [] } })
    expect(await screen.findByText('Aún no tienes mensajes')).toBeTruthy()
    expect(screen.getByText(/Tu número queda oculto/)).toBeTruthy()
  })

  it('shows loading, then an error with a way to retry', async () => {
    show({ status: 500 })
    expect(screen.getByRole('status', { name: 'Cargando tus mensajes' })).toBeTruthy()
    expect(await screen.findByText('No pudimos cargar tus mensajes')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    await waitFor(() => expect(screen.getByText('No pudimos cargar tus mensajes')).toBeTruthy())
  })
})
