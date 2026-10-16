// @vitest-environment jsdom
import type { HelpNeed } from '@contracts/help-case'
import type { User } from '@contracts/session'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderWithQuery, stubApi } from '../../test-utils'
import { CloseHelpForm } from './CloseHelpForm'
import { PledgeForm } from './PledgeForm'

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
const ride: HelpNeed = {
  id: 'need-max-ride',
  kind: 'transport',
  detail: 'De Envigado a Laureles, martes 8 a. m.',
  target: 1,
  neededBy: null,
  status: 'open',
  confirmed: 0,
  pledged: 0,
}
const home: HelpNeed = { ...ride, id: 'need-max-home', kind: 'foster', detail: 'Dos semanas' }

function show(user: User, need: HelpNeed, answer: () => { status?: number; body?: unknown }) {
  const calls = stubApi({ 'POST /cases/HE7PA/pledges': answer })
  renderWithQuery(
    <PledgeForm
      code="HE7PA"
      need={need}
      beneficiaryName="Julián R."
      user={user}
      demoCode="123456"
      onDone={() => {}}
    />,
  )
  return calls
}

const sent = () => ({
  status: 201,
  body: { id: 'pl-9', whatsapp_url: 'https://wa.me/573000000006' },
})
const pledges = (calls: ReturnType<typeof stubApi>) =>
  calls.filter((c) => c.key === 'POST /cases/HE7PA/pledges')

describe('PledgeForm — 07 · «Yo ayudo»: the row first, then the channel', () => {
  it('offers on that need with a note, then opens WhatsApp with the beneficiary', async () => {
    const calls = show(verified, ride, sent)
    fireEvent.change(screen.getByLabelText(/Un mensaje para Julián R\./), {
      target: { value: ' Tengo carro. ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Ofrecer y escribirle' }))

    expect(await screen.findByText('Le avisamos a Julián R.')).toBeTruthy()
    expect(pledges(calls)[0]?.body).toEqual({
      need_id: 'need-max-ride',
      quantity: 1,
      note: 'Tengo carro.',
      phone: null,
      phone_has_whatsapp: true,
      otp_code: null,
    })
    expect(open).toHaveBeenCalledWith('https://wa.me/573000000006')
    // Strangers meet and an animal changes hands: the safety rule comes with the channel.
    expect(screen.getByText(/encuéntrense en un lugar público/)).toBeTruthy()
  })

  it('a foster is one home: no quantity is asked', () => {
    show(verified, home, sent)
    expect(screen.queryByLabelText('¿Cuántos?')).toBeNull()
  })

  it('refuses a quantity that is not a whole number', () => {
    const calls = show(verified, ride, sent)
    fireEvent.change(screen.getByLabelText('¿Cuántos?'), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ofrecer y escribirle' }))
    expect(screen.getByText('Escribe un número entre 1 y 99')).toBeTruthy()
    expect(pledges(calls)).toEqual([])
  })

  it('a pledger without a number verifies one by SMS: a foster we cannot reach is not a foster', async () => {
    let attempt = 0
    const calls = show(newcomer, ride, () =>
      ++attempt === 1 ? { body: { phone_step: 'otp' } } : sent(),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Ofrecer y escribirle' }))
    expect(screen.getByText(/Revisa el número/)).toBeTruthy()
    expect(pledges(calls)).toEqual([])

    // The country's prefix and rules arrive with /config.
    await screen.findByText('+57')
    fireEvent.change(screen.getByLabelText('Tu celular'), { target: { value: '300 111 2233' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ofrecer y escribirle' }))
    fireEvent.change(await screen.findByLabelText('Código que te enviamos por SMS'), {
      target: { value: '123456' },
    })
    expect(await screen.findByText('Le avisamos a Julián R.')).toBeTruthy()
    expect(pledges(calls).map((c) => (c.body as { otp_code: string | null }).otp_code)).toEqual([
      null,
      '123456',
    ])
  })

  it('opens no channel when the offer could not be recorded', async () => {
    show(verified, ride, () => ({ status: 500 }))
    fireEvent.click(screen.getByRole('button', { name: 'Ofrecer y escribirle' }))
    expect(await screen.findByText('No pudimos enviar tu oferta.')).toBeTruthy()
    expect(open).not.toHaveBeenCalled()
  })

  it('without WhatsApp, says they will write here', async () => {
    show(verified, ride, () => ({ status: 201, body: { id: 'pl-9', whatsapp_url: null } }))
    fireEvent.click(screen.getByRole('button', { name: 'Ofrecer y escribirle' }))
    expect(await screen.findByText('Te va a escribir por aquí para coordinar.')).toBeTruthy()
    expect(open).not.toHaveBeenCalled()
  })
})

describe('CloseHelpForm — 07 · `resolution`', () => {
  it('needs a reason, then closes with it', async () => {
    const calls = stubApi({ 'POST /cases/NA7LA/close': { body: { id: 'NA7LA' } } })
    const onDone = vi.fn()
    renderWithQuery(<CloseHelpForm code="NA7LA" onDone={onDone} />)
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar solicitud' }))
    expect(screen.getByRole('alert').textContent).toBe('Elige una opción')
    fireEvent.click(screen.getByLabelText('Ya no necesita ayuda'))
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar solicitud' }))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(calls.at(-1)?.body).toEqual({ resolution: 'need_ended' })
  })
})
