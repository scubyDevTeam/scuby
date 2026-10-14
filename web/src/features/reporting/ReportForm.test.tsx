// @vitest-environment jsdom
import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderWithQuery, stubApi } from '../../test-utils'
import { ReportForm } from './ReportForm'

const show = (targetType: 'lost_case' | 'help_request' = 'lost_case') => {
  const calls = stubApi({ 'POST /reports': { status: 201, body: { id: 'report-1' } } })
  renderWithQuery(<ReportForm targetType={targetType} targetCode="7K3PQ" onDone={() => {}} />)
  return calls
}
const send = () => fireEvent.click(screen.getByRole('button', { name: 'Enviar reporte' }))

describe('ReportForm — 09 · anonymous, a reason and nothing else', () => {
  it('sends the reason and the optional note', async () => {
    const calls = show()
    fireEvent.click(screen.getByLabelText('Estafa o piden dinero'))
    fireEvent.change(screen.getByLabelText(/Cuéntanos más/), { target: { value: ' Piden plata ' } })
    send()

    expect(await screen.findByText('Gracias por avisar.')).toBeTruthy()
    expect(calls.at(-1)?.body).toEqual({
      target_type: 'lost_case',
      target_id: '7K3PQ',
      reason: 'scam_or_extortion',
      note: 'Piden plata',
    })
  })

  it('requires a reason', () => {
    const calls = show()
    send()
    expect(screen.getByRole('alert').textContent).toBe('Elige un motivo')
    expect(calls.some((call) => call.key === 'POST /reports')).toBe(false)
  })

  it('says a normal report leaves the publication visible', () => {
    show()
    fireEvent.click(screen.getByLabelText('Spam'))
    expect(screen.getByText(/la publicación sigue visible/)).toBeTruthy()
  })

  it('says personal data is hidden at once (rule 2)', () => {
    show()
    fireEvent.click(screen.getByLabelText('Muestra datos personales'))
    expect(screen.getByText(/la ocultamos de inmediato/)).toBeTruthy()
  })

  it('says a scam report pauses a help request (rule 4)', () => {
    show('help_request')
    fireEvent.click(screen.getByLabelText('Estafa o piden dinero'))
    expect(screen.getByText(/la pausamos de inmediato/)).toBeTruthy()
  })
})
