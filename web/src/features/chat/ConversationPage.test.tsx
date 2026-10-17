// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { at, threadAnswer } from '../../mocks/chat-wire'
import { renderWithQuery, stubApi } from '../../test-utils'
import { ConversationPage } from './ConversationPage'

function show(thread: unknown, extra: Parameters<typeof stubApi>[0] = {}) {
  const calls = stubApi({
    'GET /conversations/c-1': { body: thread },
    'POST /conversations/c-1/read': { status: 204 },
    ...extra,
  })
  renderWithQuery(
    <ConversationPage
      id="c-1"
      backLink={<a href="/bandeja">Volver</a>}
      caseLink={(code, children) => <a href={`/c/${code}`}>{children}</a>}
    />,
  )
  return calls
}

describe('ConversationPage — one thread', () => {
  it('shows who it is with, that the number stays hidden, and the case it is about', async () => {
    show(threadAnswer())
    expect(await screen.findByRole('heading', { name: 'Andrés R.' })).toBeTruthy()
    expect(screen.getByText(/su número queda oculto/)).toBeTruthy()
    expect(screen.getByText('Reclamo «Es mío» · hace 12 min')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Ver caso' }).getAttribute('href')).toBe('/c/C4STD')
  })

  it('reads messages oldest first: the automatic evidence, theirs, mine, a shared WhatsApp', async () => {
    show(threadAnswer())
    const list = await screen.findByRole('list', { name: 'Mensajes' })
    const items = within(list).getAllByRole('listitem')
    expect(items[0]?.textContent).toContain('Mensaje automático · evidencia de «Es mío»')
    expect(items[1]?.textContent).toContain('Hola, creo que es Michi.')
    expect(items[2]?.textContent).toContain('¿Cómo se llama')
    expect(items[3]?.textContent).toContain('Andrés R. te dio su WhatsApp')
    expect(
      within(items[3]!).getByRole('link', { name: 'Abrir WhatsApp' }).getAttribute('href'),
    ).toBe('https://wa.me/573000000001')
  })

  it('opening the thread reads it', async () => {
    const calls = show(threadAnswer())
    await screen.findByRole('heading', { name: 'Andrés R.' })
    await waitFor(() =>
      expect(calls.some((c) => c.key === 'POST /conversations/c-1/read')).toBe(true),
    )
  })

  it('sends what is typed, trimmed, and clears the box', async () => {
    const calls = show(threadAnswer(), {
      'POST /conversations/c-1/messages': {
        status: 201,
        body: {
          id: 'm-9',
          kind: 'text',
          label: null,
          body: 'Hola',
          photo_urls: [],
          phone: null,
          whatsapp_url: null,
          mine: true,
          sent_at: at(0),
        },
      },
    })
    const box = (await screen.findByRole('textbox', {
      name: 'Escribe un mensaje',
    })) as HTMLInputElement
    fireEvent.change(box, { target: { value: '  Hola  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))
    await waitFor(() =>
      expect(calls.find((c) => c.key === 'POST /conversations/c-1/messages')?.body).toEqual({
        body: 'Hola',
      }),
    )
    await waitFor(() => expect(box.value).toBe(''))
  })

  it('does not send a blank message', async () => {
    const calls = show(threadAnswer())
    await screen.findByRole('textbox', { name: 'Escribe un mensaje' })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))
    expect(calls.some((c) => c.key === 'POST /conversations/c-1/messages')).toBe(false)
  })

  it('says when a message did not go, and keeps the text', async () => {
    show(threadAnswer(), { 'POST /conversations/c-1/messages': { status: 500 } })
    const box = (await screen.findByRole('textbox', {
      name: 'Escribe un mensaje',
    })) as HTMLInputElement
    fireEvent.change(box, { target: { value: 'Hola' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))
    expect(await screen.findByText(/No se envió/)).toBeTruthy()
    expect(box.value).toBe('Hola')
  })

  it('offers «Dar mi WhatsApp» while it can be given, and posts it', async () => {
    const calls = show(threadAnswer(), {
      'POST /conversations/c-1/whatsapp': {
        status: 201,
        body: {
          id: 'm-10',
          kind: 'whatsapp',
          label: null,
          body: '',
          photo_urls: [],
          phone: '+573007152284',
          whatsapp_url: 'https://wa.me/573007152284',
          mine: true,
          sent_at: at(0),
        },
      },
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Dar mi WhatsApp' }))
    await waitFor(() =>
      expect(calls.some((c) => c.key === 'POST /conversations/c-1/whatsapp')).toBe(true),
    )
  })

  it('does not offer it once it was given', async () => {
    show(threadAnswer({ can_share_whatsapp: false }))
    await screen.findByRole('textbox', { name: 'Escribe un mensaje' })
    expect(screen.queryByRole('button', { name: 'Dar mi WhatsApp' })).toBeNull()
  })

  it('a closed thread is read-only: the footer instead of the box, and who closed it on the card', async () => {
    show(
      threadAnswer({
        closed: {
          at: new Date('2026-10-03T15:00:00-05:00').toISOString(),
          note: '¡Volvió con su familia!',
        },
        can_share_whatsapp: false,
      }),
    )
    expect(await screen.findByText(/queda solo para leer/)).toBeTruthy()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Enviar' })).toBeNull()
    expect(screen.getByText(/¡Volvió con su familia! · /)).toBeTruthy()
  })

  it('a thread that is not yours, or does not exist, says so', async () => {
    show(null, { 'GET /conversations/c-1': { status: 404 } })
    expect(await screen.findByText(/no existe o no es tuya/)).toBeTruthy()
  })

  it('a network failure offers to retry', async () => {
    show(null, { 'GET /conversations/c-1': { status: 500 } })
    expect(await screen.findByText('No pudimos abrir la conversación')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeTruthy()
  })
})
