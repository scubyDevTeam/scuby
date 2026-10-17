// @vitest-environment jsdom
import { type LostCase, parseCase } from '@contracts/case'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { cases } from '../../mocks/fixtures'
import { renderWithQuery, stubApi } from '../../test-utils'
import { EditLost } from './EditLost'

function luna(): LostCase {
  const parsed = parseCase(cases('responsible')['7K3PQ'])
  if (parsed.vertical !== 'lost') throw new Error('expected a lost case')
  return parsed
}

function show(routes: Parameters<typeof stubApi>[0] = {}) {
  const calls = stubApi({ 'PATCH /lost-cases/7K3PQ': { status: 204 }, ...routes })
  const onDone = vi.fn()
  renderWithQuery(<EditLost lostCase={luna()} mapStyleUrl={undefined} onDone={onDone} />)
  return { calls, onDone }
}

const save = () => fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
const patched = (calls: ReturnType<typeof stubApi>) =>
  calls.find((c) => c.key === 'PATCH /lost-cases/7K3PQ')?.body as Record<string, unknown>

describe('EditLost — «Editar aviso»', () => {
  it('opens on what the case says now, and promises not to tell the neighbours again', async () => {
    show()
    expect((await screen.findByLabelText(/Señas/)) as HTMLTextAreaElement).toHaveProperty(
      'value',
      luna().pet.marks,
    )
    expect(screen.getByText(/No volvemos a avisar a los vecinos/)).toBeTruthy()
    expect(screen.getByText('Corregir la zona no vuelve a avisar a los vecinos.')).toBeTruthy()
  })

  it('sends the corrected signs with the photos, the zone and the time it had', async () => {
    const { calls } = show()
    const marks = (await screen.findByLabelText(/Señas/)) as HTMLTextAreaElement
    fireEvent.change(marks, { target: { value: '  Collar azul  ' } })
    save()

    expect(await screen.findByText('Listo, guardamos los cambios.')).toBeTruthy()
    const body = patched(calls)
    expect(body.marks).toBe('Collar azul')
    expect(body.photo_urls).toEqual(luna().pet.photoUrls)
    expect(body.last_seen_point).toEqual(luna().lastSeen.center)
    expect(body.last_seen_radius_m).toBe(luna().lastSeen.radiusM)
    expect(typeof body.last_seen_at).toBe('string')
  })

  it('an emptied signs field is sent as null, so it is cleared', async () => {
    const { calls } = show()
    fireEvent.change(await screen.findByLabelText(/Señas/), { target: { value: '   ' } })
    save()
    await waitFor(() => expect(patched(calls)?.marks).toBeNull())
  })

  it('says so when it could not save, and keeps the form', async () => {
    show({ 'PATCH /lost-cases/7K3PQ': { status: 500 } })
    fireEvent.click(await screen.findByRole('button', { name: 'Guardar cambios' }))
    expect(await screen.findByText(/No pudimos guardar los cambios/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeTruthy()
  })

  it('«Listo» closes the sheet after saving', async () => {
    const { onDone } = show()
    save()
    fireEvent.click(await screen.findByRole('button', { name: 'Listo' }))
    expect(onDone).toHaveBeenCalled()
  })
})
