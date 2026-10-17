// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithQuery, stubApi } from '../../test-utils'
import { StartChat } from './StartChat'

function show(answer: { status?: number; body?: unknown }) {
  const calls = stubApi({ 'POST /cases/F8UND/conversations': answer })
  const onDone = vi.fn()
  renderWithQuery(
    <StartChat
      code="F8UND"
      name="Marcela T."
      threadLink={(id, children) => <a href={`/mensajes/${id}`}>{children}</a>}
      onDone={onDone}
    />,
  )
  return { calls, onDone }
}

const type = (text: string) =>
  fireEvent.change(screen.getByRole('textbox', { name: 'Tu mensaje' }), { target: { value: text } })
const send = () => fireEvent.click(screen.getByRole('button', { name: 'Enviar mensaje' }))

describe('StartChat — «Escribirle por chat»', () => {
  it('says who will see it and that the number is not shared', () => {
    show({ status: 201, body: { id: 'c-9' } })
    expect(screen.getByText(/Marcela T\. verá tu mensaje/)).toBeTruthy()
    expect(screen.getByText(/Tu número no se comparte/)).toBeTruthy()
  })

  it('creates the thread with the first message, then links to it', async () => {
    const { calls } = show({ status: 201, body: { id: 'c-9' } })
    type('  Creo que es mi gato  ')
    send()
    expect(await screen.findByText('Mensaje enviado')).toBeTruthy()
    expect(calls.find((c) => c.key === 'POST /cases/F8UND/conversations')?.body).toEqual({
      body: 'Creo que es mi gato',
    })
    expect(screen.getByRole('link', { name: 'Ver la conversación' }).getAttribute('href')).toBe(
      '/mensajes/c-9',
    )
  })

  it('asks for words before sending anything', () => {
    const { calls } = show({ status: 201, body: { id: 'c-9' } })
    send()
    expect(screen.getByText('Escribe algo para enviarlo.')).toBeTruthy()
    expect(calls.some((c) => c.key.startsWith('POST'))).toBe(false)
  })

  it('says it is your own notice when the server refuses with forbidden', async () => {
    show({ status: 403 })
    type('Hola')
    send()
    expect(await screen.findByText('Este aviso es tuyo.')).toBeTruthy()
  })

  it('says the case ended when it already did', async () => {
    show({ status: 409 })
    type('Hola')
    send()
    expect(await screen.findByText('Este caso ya terminó.')).toBeTruthy()
  })

  it('any other failure can be tried again, keeping the text', async () => {
    show({ status: 500 })
    type('Hola')
    send()
    expect(await screen.findByText(/No pudimos enviarlo/)).toBeTruthy()
    expect((screen.getByRole('textbox', { name: 'Tu mensaje' }) as HTMLTextAreaElement).value).toBe(
      'Hola',
    )
  })

  it('«Listo» closes the sheet after sending', async () => {
    const { onDone } = show({ status: 201, body: { id: 'c-9' } })
    type('Hola')
    send()
    fireEvent.click(await screen.findByRole('button', { name: 'Listo' }))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
  })
})
