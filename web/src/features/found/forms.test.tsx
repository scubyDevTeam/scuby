// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithQuery, stubApi } from '../../test-utils'
import { ResolveForm } from './CustodianForms'
import { OwnershipClaimForm } from './OwnershipClaimForm'

const ok = { body: { id: 'F8UND' } }

describe('OwnershipClaimForm — 05 · «Es mío»', () => {
  const claimed = { status: 201, body: { id: 'own-9', whatsapp_url: 'https://wa.me/573000000002' } }

  it('creates the claim with the evidence offered, then opens the channel', async () => {
    const calls = stubApi({ 'POST /cases/F8UND/ownership-claims': claimed })
    const open = vi.fn()
    vi.stubGlobal('open', open)
    renderWithQuery(<OwnershipClaimForm code="F8UND" onDone={() => {}} />)
    fireEvent.change(screen.getByLabelText(/Describe algo/), {
      target: { value: 'Mancha blanca en la pata' },
    })
    fireEvent.change(screen.getByLabelText(/microchip/), { target: { value: '900123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Avisar que es mío' }))

    expect(await screen.findByText('Le avisamos a quien lo cuida.')).toBeTruthy()
    expect(calls.at(-1)?.body).toEqual({
      evidence_notes: 'Mancha blanca en la pata',
      chip_number: '900123',
    })
    expect(open).toHaveBeenCalledWith('https://wa.me/573000000002', '_blank', 'noopener')
  })

  it('allows a cold claim: proof is offered, never required', async () => {
    const calls = stubApi({ 'POST /cases/F8UND/ownership-claims': claimed })
    vi.stubGlobal('open', vi.fn())
    renderWithQuery(<OwnershipClaimForm code="F8UND" onDone={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Avisar que es mío' }))
    await screen.findByText('Le avisamos a quien lo cuida.')
    expect(calls.at(-1)?.body).toEqual({ evidence_notes: null, chip_number: null })
  })

  it('opens no channel when the claim could not be created', async () => {
    stubApi({ 'POST /cases/F8UND/ownership-claims': { status: 500 } })
    const open = vi.fn()
    vi.stubGlobal('open', open)
    renderWithQuery(<OwnershipClaimForm code="F8UND" onDone={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Avisar que es mío' }))
    expect(await screen.findByText('No pudimos enviar tu mensaje.')).toBeTruthy()
    expect(open).not.toHaveBeenCalled()
  })
})

describe('ResolveForm — 05 · only the custodian ends custody', () => {
  function show(
    outcome: 'reunited' | 'kept' | 'transferred_to_org' | 'cancelled',
    suggested: string | null = null,
  ) {
    const calls = stubApi({ 'POST /cases/F8UND/resolve': ok })
    const onDone = vi.fn()
    renderWithQuery(
      <ResolveForm code="F8UND" outcome={outcome} suggested={suggested} onDone={onDone} />,
    )
    return { calls, onDone }
  }

  it('a hand-off asks who helped, starting on the suggestion', async () => {
    const { calls, onDone } = show('reunited', 'platform_claim')
    fireEvent.click(screen.getByRole('button', { name: 'Sí, ya está con su dueño' }))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(calls.at(-1)?.body).toMatchObject({
      outcome: 'reunited',
      resolution_attribution: 'platform_claim',
    })
  })

  it('a hand-off without an answer is not sent', () => {
    const { calls } = show('reunited')
    fireEvent.click(screen.getByRole('button', { name: 'Sí, ya está con su dueño' }))
    expect(screen.getByRole('alert').textContent).toBe('Elige una opción')
    expect(calls.some((c) => c.key.startsWith('POST'))).toBe(false)
  })

  it('«me lo quedo» is available from day one and suggests waiting', async () => {
    const { calls } = show('kept')
    expect(screen.getByText(/espera unos días más/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Me lo quedo' }))
    await waitFor(() => expect(calls.at(-1)?.body).toMatchObject({ outcome: 'kept' }))
  })

  it('a hand-off to a foundation optionally names it', async () => {
    const { calls } = show('transferred_to_org')
    fireEvent.change(screen.getByLabelText(/fundación/), { target: { value: ' Patitas ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar entrega' }))
    await waitFor(() =>
      expect(calls.at(-1)?.body).toMatchObject({
        outcome: 'transferred_to_org',
        org_name: 'Patitas',
      }),
    )
  })

  it('deleting needs a reason', async () => {
    const { calls } = show('cancelled')
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar aviso' }))
    expect(screen.getByRole('alert').textContent).toBe('Elige una opción')
    fireEvent.click(screen.getByLabelText('Se fue de nuevo'))
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar aviso' }))
    await waitFor(() =>
      expect(calls.at(-1)?.body).toMatchObject({
        outcome: 'cancelled',
        resolution: 'ran_off_again',
      }),
    )
  })
})
