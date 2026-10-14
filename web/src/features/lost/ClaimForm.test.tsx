// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithQuery, stubApi } from '../../test-utils'
import { ClaimForm } from './ClaimForm'

const claimed = { status: 201, body: { id: 'claim-1', whatsapp_url: 'https://wa.me/573000000000' } }

function show(routes: Parameters<typeof stubApi>[0] = {}) {
  const calls = stubApi(routes)
  const open = vi.fn()
  vi.stubGlobal('open', open)
  const onOnlySaw = vi.fn()
  renderWithQuery(<ClaimForm code="7K3PQ" petName="Luna" onDone={() => {}} onOnlySaw={onOnlySaw} />)
  return { calls, open, onOnlySaw }
}

const type = async (value: string) => {
  await screen.findByText('+57')
  fireEvent.change(screen.getByLabelText('Tu celular'), { target: { value } })
}
const submit = () =>
  fireEvent.click(screen.getByRole('button', { name: /Avisar y abrir WhatsApp/ }))

describe('ClaimForm — 04 · «Lo tengo» creates a claim before it opens a channel', () => {
  it('sends the claim first and only then opens WhatsApp with the family', async () => {
    const { calls, open } = show({ 'POST /cases/7K3PQ/recovery-claims': claimed })
    await type('311 482 9017')
    submit()

    expect(await screen.findByText('Ya le avisamos a su familia.')).toBeTruthy()
    expect(calls.at(-1)).toEqual({
      key: 'POST /cases/7K3PQ/recovery-claims',
      body: { phone: '+573114829017' },
    })
    expect(open).toHaveBeenCalledWith('https://wa.me/573000000000', '_blank', 'noopener')
    expect(screen.getByRole('link', { name: 'Abrir WhatsApp' })).toBeTruthy()
  })

  it('requires the phone: a claim nobody can reach is worthless', async () => {
    const { calls, open } = show()
    await screen.findByText('+57')
    submit()

    expect(screen.getByRole('alert').textContent).toBe('Escribe tu número de celular')
    expect(calls.some((call) => call.key.startsWith('POST'))).toBe(false)
    expect(open).not.toHaveBeenCalled()
  })

  it('rejects a number that is not a mobile of the country', async () => {
    const { calls } = show()
    await type('604 482 9017')
    submit()

    expect(screen.getByRole('alert').textContent).toBe('Revisa el número de celular')
    expect(calls.some((call) => call.key.startsWith('POST'))).toBe(false)
  })

  it('never opens WhatsApp when the claim could not be created', async () => {
    const { open } = show({ 'POST /cases/7K3PQ/recovery-claims': { status: 500 } })
    await type('3114829017')
    submit()

    expect(await screen.findByText('No pudimos avisar a su familia.')).toBeTruthy()
    expect(open).not.toHaveBeenCalled()
  })

  it('offers the way out to a sighting', async () => {
    const { onOnlySaw } = show()
    fireEvent.click(screen.getByRole('button', { name: 'Solo la vi, no la tengo' }))
    await waitFor(() => expect(onOnlySaw).toHaveBeenCalled())
  })
})
