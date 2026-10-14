// @vitest-environment jsdom
import type { User } from '@contracts/session'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderWithQuery, stubApi } from '../../test-utils'
import { InterestForm } from './InterestForm'

const open = vi.fn()
vi.mock('@platform/navigation', () => ({ openExternal: (url: string) => open(url) }))
afterEach(() => open.mockReset())

const verified: User = {
  id: 'u1',
  displayName: 'Laura',
  email: 'l@correo.co',
  phone: '+573001112233',
}
const newcomer: User = { ...verified, phone: null }

function show(user: User, answer: unknown | (() => { body: unknown })) {
  const calls = stubApi({
    'POST /cases/AD9PT/interests':
      typeof answer === 'function' ? (answer as () => { body: unknown }) : { body: answer },
  })
  const onDone = vi.fn()
  renderWithQuery(
    <InterestForm
      code="AD9PT"
      petName="Nube"
      listerName="Sofía V."
      link="https://example.test/c/AD9PT"
      user={user}
      demoCode="123456"
      onDone={onDone}
    />,
  )
  return calls
}

function introduce() {
  fireEvent.click(screen.getByRole('button', { name: 'Apartamento' }))
  fireEvent.click(screen.getByRole('button', { name: 'No' }))
  fireEvent.change(screen.getByLabelText(/¿Por qué Nube\?/), { target: { value: 'Tengo tiempo.' } })
}

const posts = (calls: ReturnType<typeof stubApi>) =>
  calls.filter((c) => c.key === 'POST /cases/AD9PT/interests')

describe('InterestForm — 06 · «Me interesa»: one screen before the channel', () => {
  it('asks for housing, yard and why before anything is sent', () => {
    const calls = show(verified, {})
    fireEvent.click(screen.getByRole('button', { name: 'Enviar y escribirle' }))
    expect(screen.getByText('Dinos si vives en casa o apartamento')).toBeTruthy()
    expect(screen.getByText('Dinos si tienes patio')).toBeTruthy()
    expect(screen.getByText('Cuéntale por qué')).toBeTruthy()
    expect(posts(calls)).toEqual([])
  })

  it('the row first, then WhatsApp opens with the intro prefilled, with the safety copy', async () => {
    const calls = show(verified, {
      id: 'int-1',
      whatsapp_url: 'https://wa.me/573000000005',
      external_url: null,
    })
    introduce()
    fireEvent.click(screen.getByRole('button', { name: 'Enviar y escribirle' }))
    await waitFor(() => expect(open).toHaveBeenCalled())
    expect(posts(calls)[0]?.body).toMatchObject({
      intro: { housing: 'apartment', has_yard: false, why: 'Tengo tiempo.', other_pets: null },
      phone: null,
    })
    expect(decodeURIComponent(open.mock.calls[0]?.[0] ?? '')).toContain(
      'Hola, me interesa adoptar a Nube',
    )
    expect(screen.getByText(/Nunca pagues nada antes de conocerlo/)).toBeTruthy()
  })

  it('WhatsApp and the lister’s own site: both, one tap each, nothing opened for them', async () => {
    show(verified, {
      id: 'int-1',
      whatsapp_url: 'https://wa.me/573000000005',
      external_url: 'https://fundacion.example/adopta',
    })
    introduce()
    fireEvent.click(screen.getByRole('button', { name: 'Enviar y escribirle' }))
    expect(await screen.findByRole('link', { name: 'Aplicar en su sitio' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Escribir por WhatsApp' })).toBeTruthy()
    expect(open).not.toHaveBeenCalled()
  })

  it('in-app only: they will write back here', async () => {
    show(verified, { id: 'int-1', whatsapp_url: null, external_url: null })
    introduce()
    fireEvent.click(screen.getByRole('button', { name: 'Enviar y escribirle' }))
    expect(await screen.findByText('Te escribirá por aquí cuando la lea.')).toBeTruthy()
  })

  it('without a verified number: the number, then the SMS code, then the row', async () => {
    let asked = 0
    const calls = show(newcomer, () =>
      asked++ === 0
        ? { body: { phone_step: 'otp' } }
        : { body: { id: 'int-1', whatsapp_url: null, external_url: null } },
    )
    introduce()
    // The country's prefix comes from configuration (auth.md), never from code.
    await screen.findByText('+57')
    fireEvent.change(screen.getByLabelText('Tu celular'), { target: { value: '300 111 2233' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar y escribirle' }))
    fireEvent.change(await screen.findByLabelText('Código que te enviamos por SMS'), {
      target: { value: '123456' },
    })
    await screen.findByText('Te escribirá por aquí cuando la lea.')
    expect(posts(calls).map((c) => (c.body as { otp_code: string | null }).otp_code)).toEqual([
      null,
      '123456',
    ])
    expect(posts(calls)[0]?.body).toMatchObject({ phone: '+573001112233' })
  })
})
