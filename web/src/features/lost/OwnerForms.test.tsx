// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithQuery, stubApi } from '../../test-utils'
import { CancelForm, ReopenForm, ReuniteForm } from './OwnerForms'

const ok = { body: { id: '7K3PQ' } }

describe('ReuniteForm — 04 · only the owner closes, and says who helped', () => {
  it('closes the case with the chosen attribution', async () => {
    const calls = stubApi({ 'POST /cases/7K3PQ/reunite': ok })
    const onDone = vi.fn()
    renderWithQuery(<ReuniteForm code="7K3PQ" petName="Luna" suggested={null} onDone={onDone} />)
    fireEvent.click(screen.getByLabelText('Alguien la vio y avisó aquí'))
    fireEvent.click(screen.getByRole('button', { name: 'Sí, Luna ya está en casa' }))

    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(calls.at(-1)?.body).toEqual({ resolution_attribution: 'platform_sighting' })
  })

  it('starts on the suggested answer and still lets the owner change it', () => {
    stubApi()
    renderWithQuery(
      <ReuniteForm code="7K3PQ" petName="Luna" suggested="platform_claim" onDone={() => {}} />,
    )
    expect(
      (screen.getByLabelText('Alguien la tenía y avisó aquí') as HTMLInputElement).checked,
    ).toBe(true)
    fireEvent.click(screen.getByLabelText('Apareció por otro lado'))
    expect((screen.getByLabelText('Apareció por otro lado') as HTMLInputElement).checked).toBe(true)
  })

  it('does not close without an answer', () => {
    const calls = stubApi()
    renderWithQuery(<ReuniteForm code="7K3PQ" petName="Luna" suggested={null} onDone={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Sí, Luna ya está en casa' }))
    expect(screen.getByRole('alert').textContent).toBe('Elige una opción')
    expect(calls.some((c) => c.key.startsWith('POST'))).toBe(false)
  })

  it('stays open and says so when the server fails', async () => {
    stubApi({ 'POST /cases/7K3PQ/reunite': { status: 500 } })
    const onDone = vi.fn()
    renderWithQuery(<ReuniteForm code="7K3PQ" petName="Luna" suggested="unknown" onDone={onDone} />)
    fireEvent.click(screen.getByRole('button', { name: 'Sí, Luna ya está en casa' }))
    expect(await screen.findByText('No pudimos guardarlo.')).toBeTruthy()
    expect(onDone).not.toHaveBeenCalled()
  })
})

describe('CancelForm', () => {
  it('cancels with a reason, and points a reunion to the right button', async () => {
    const calls = stubApi({ 'POST /cases/7K3PQ/cancel': ok })
    const onDone = vi.fn()
    renderWithQuery(<CancelForm code="7K3PQ" onDone={onDone} />)
    expect(screen.getByText(/usa «Ya apareció»/)).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Fue una falsa alarma'))
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar aviso' }))

    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(calls.at(-1)?.body).toEqual({ resolution: 'false_alarm' })
  })

  it('needs a reason', () => {
    const calls = stubApi()
    renderWithQuery(<CancelForm code="7K3PQ" onDone={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar aviso' }))
    expect(screen.getByRole('alert').textContent).toBe('Elige un motivo')
    expect(calls.some((c) => c.key.startsWith('POST'))).toBe(false)
  })
})

describe('ReopenForm — 04 · one tap', () => {
  it('reopens the case', async () => {
    const calls = stubApi({ 'POST /cases/ARCH2/reopen': ok })
    const onDone = vi.fn()
    renderWithQuery(<ReopenForm code="ARCH2" petName="Kira" onDone={onDone} />)
    fireEvent.click(screen.getByRole('button', { name: 'Reactivar aviso' }))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(calls.at(-1)?.key).toBe('POST /cases/ARCH2/reopen')
  })
})

describe('OwnerForms — 04 · closing while «¿sigue perdida?» waits answers it', () => {
  const path = 'POST /cases/M2TQ4/checkins/ck-milo-1/answer'

  it('«Ya apareció» is sent as the check-in’s answer, with who helped', async () => {
    const calls = stubApi({ [path]: { body: { id: 'ck-milo-1' } } })
    const onDone = vi.fn()
    renderWithQuery(
      <ReuniteForm
        code="M2TQ4"
        petName="Milo"
        suggested={null}
        checkinId="ck-milo-1"
        onDone={onDone}
      />,
    )
    fireEvent.click(screen.getByLabelText('Apareció por otro lado'))
    fireEvent.click(screen.getByRole('button', { name: 'Sí, Milo ya está en casa' }))

    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(calls.at(-1)).toEqual({
      key: path,
      body: { response: 'reunited', resolution_attribution: 'offline', resolution: null },
    })
  })

  it('«Eliminar» is sent as the check-in’s answer, with the reason', async () => {
    const calls = stubApi({ [path]: { body: { id: 'ck-milo-1' } } })
    const onDone = vi.fn()
    renderWithQuery(<CancelForm code="M2TQ4" checkinId="ck-milo-1" onDone={onDone} />)
    fireEvent.click(screen.getByLabelText('Lo publiqué dos veces'))
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar aviso' }))

    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(calls.at(-1)).toEqual({
      key: path,
      body: { response: 'delete', resolution_attribution: null, resolution: 'duplicate' },
    })
  })
})
