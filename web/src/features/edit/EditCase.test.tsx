// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithQuery, stubApi } from '../../test-utils'
import { type Editable, EditCase } from './EditCase'

const adoption: Editable = {
  code: 'M1SHI',
  photoUrls: ['data:image/png;base64,AAAA'],
  story: 'La encontré en el parque.',
  temperament: ['puppy'],
  requirements: null,
}

function show(editable: Editable, routes: Parameters<typeof stubApi>[0] = {}) {
  const calls = stubApi({ 'PATCH /cases/M1SHI': { status: 204 }, ...routes })
  const onDone = vi.fn()
  renderWithQuery(<EditCase editable={editable} onDone={onDone} />)
  return { calls, onDone }
}
const save = () => fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
const sent = (calls: ReturnType<typeof stubApi>) =>
  calls.find((c) => c.key === 'PATCH /cases/M1SHI')?.body as Record<string, unknown>

describe('EditCase — found, adoption and help notices', () => {
  it('shows only the fields its vertical has', () => {
    show(adoption)
    expect(screen.getByLabelText('Historia')).toBeTruthy()
    expect(screen.getByLabelText(/Requisitos/)).toBeTruthy()
    expect(screen.queryByLabelText(/Señas/)).toBeNull()
  })

  it('a found notice has signs and no story', () => {
    show({ code: 'M1SHI', photoUrls: ['x'], marks: 'Collar' })
    expect(screen.getByLabelText(/Señas/)).toBeTruthy()
    expect(screen.queryByLabelText('Historia')).toBeNull()
  })

  it('sends the corrected story, trimmed, with the rest as it was', async () => {
    const { calls } = show(adoption)
    fireEvent.change(screen.getByLabelText('Historia'), { target: { value: '  Nueva  ' } })
    save()
    expect(await screen.findByText('Listo, guardamos los cambios.')).toBeTruthy()
    expect(sent(calls)).toMatchObject({
      story: 'Nueva',
      temperament: ['puppy'],
      requirements: null,
    })
  })

  it('does not send an emptied story', () => {
    const { calls } = show(adoption)
    fireEvent.change(screen.getByLabelText('Historia'), { target: { value: ' ' } })
    save()
    expect(screen.getByText('Cuenta algo para que te entiendan.')).toBeTruthy()
    expect(calls.some((c) => c.key.startsWith('PATCH'))).toBe(false)
  })

  it('says so when it could not save, and «Listo» closes after saving', async () => {
    show(adoption, { 'PATCH /cases/M1SHI': { status: 500 } })
    save()
    expect(await screen.findByText(/No pudimos guardar los cambios/)).toBeTruthy()
  })

  it('«Listo» closes the sheet', async () => {
    const { onDone } = show(adoption)
    save()
    fireEvent.click(await screen.findByRole('button', { name: 'Listo' }))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
  })
})
