// @vitest-environment jsdom
import { parseCase, type Sighting } from '@contracts/case'
import { placeSightings } from '@domain/lost/sightings'
import { fireEvent, screen } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { cases } from '../../mocks/fixtures'
import { renderWithQuery, stubApi } from '../../test-utils'
import { SightingSheet } from './SightingSheet'

const now = new Date()

beforeAll(() => {
  // jsdom has no modal dialogs yet.
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.open = true
  }
})

function placed(viewer: 'public' | 'responsible', id: string) {
  const lost = parseCase(cases(viewer)['7K3PQ'])
  if (lost.vertical !== 'lost') throw new Error('expected a lost case')
  const sightings = placeSightings<Sighting>(lost.sightings, lost.lastSeen.center, now)
  return sightings.find((s) => s.id === id)!
}

function show(viewer: 'public' | 'responsible', id: string, onSawItToo?: () => void) {
  const onClose = vi.fn()
  renderWithQuery(
    <SightingSheet
      code="7K3PQ"
      sighting={placed(viewer, id)}
      now={now}
      isOwner={viewer === 'responsible'}
      onClose={onClose}
      onSawItToo={onSawItToo}
    />,
  )
  return onClose
}

describe('SightingSheet (04 · Display rules 3)', () => {
  it('says which pin it is, when — absolute and relative — how far, by whom, and the note', () => {
    show('public', 's3')
    expect(screen.getByRole('heading', { name: 'Avistamiento 3' })).toBeTruthy()
    expect(screen.getByText(/^(Hoy|Ayer) /)).toBeTruthy()
    expect(screen.getByText(/^hace \d+ h · a .+ de donde se perdió$/)).toBeTruthy()
    expect(screen.getByText('Reportado por alguien con cuenta')).toBeTruthy()
    expect(screen.getByText('«Iba hacia el parque, con collar rojo»')).toBeTruthy()
    expect(screen.getByRole('img', { name: 'Foto del avistamiento' })).toBeTruthy()
  })

  it('gives a stranger no number and no tools, and «La vi aquí también» opens the sighting form', () => {
    const onSawItToo = vi.fn()
    const onClose = show('public', 's2', onSawItToo)
    expect(screen.getByText('Reportado por alguien anónimo')).toBeTruthy()
    expect(screen.queryByRole('link', { name: /Escribirle/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Marcar como útil' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'La vi aquí también' }))
    expect(onClose).toHaveBeenCalled()
    expect(onSawItToo).toHaveBeenCalled()
  })

  it('gives the owner the reporter’s number as buttons and the timeline’s own tools', async () => {
    show('responsible', 's2')
    expect(screen.getByText('+573156677889')).toBeTruthy()
    expect(screen.getByRole('link', { name: /Escribirle/ }).getAttribute('href')).toBe(
      'https://wa.me/573156677889',
    )
    expect(screen.getByRole('link', { name: /Llamar/ }).getAttribute('href')).toBe(
      'tel:+573156677889',
    )
    expect(await screen.findByRole('button', { name: /útil/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Ocultar/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'La vi aquí también' })).toBeNull()
  })
})

describe('SightingSheet — your own pin (04 · Correction window)', () => {
  const own = () => ({
    ...placed('public', 's2'),
    mine: true,
    editableUntil: new Date(now.getTime() + 10 * 60_000),
  })

  function showOwn(sighting = own(), onCorrect?: () => void) {
    const onClose = vi.fn()
    renderWithQuery(
      <SightingSheet
        code="7K3PQ"
        sighting={sighting}
        now={now}
        isOwner={false}
        onClose={onClose}
        onCorrect={onCorrect}
      />,
    )
    return onClose
  }

  it('says the pin is yours and until when, and offers to correct or delete it', () => {
    const onCorrect = vi.fn()
    showOwn(own(), onCorrect)
    expect(screen.getByText(/Es tuyo\. Puedes corregirlo o borrarlo hasta las /)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Corregir el punto' }))
    expect(onCorrect).toHaveBeenCalled()
  })

  it('past the window, or on someone else’s pin, there are no tools', () => {
    showOwn({ ...own(), editableUntil: new Date(now.getTime() - 1000) })
    expect(screen.queryByRole('button', { name: 'Corregir el punto' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Borrar mi avistamiento' })).toBeNull()
  })

  it('deleting asks first, then removes it and closes the sheet', async () => {
    const calls = stubApi({ 'DELETE /cases/7K3PQ/sightings/s2': { status: 204 } })
    const onClose = showOwn()
    fireEvent.click(screen.getByRole('button', { name: 'Borrar mi avistamiento' }))
    expect(screen.getByText(/No se puede deshacer/)).toBeTruthy()
    expect(calls.some((c) => c.key.startsWith('DELETE'))).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Sí, borrarlo' }))
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(calls.some((c) => c.key === 'DELETE /cases/7K3PQ/sightings/s2')).toBe(true)
  })

  it('«No» keeps it', () => {
    showOwn()
    fireEvent.click(screen.getByRole('button', { name: 'Borrar mi avistamiento' }))
    fireEvent.click(screen.getByRole('button', { name: 'No' }))
    expect(screen.getByRole('button', { name: 'Borrar mi avistamiento' })).toBeTruthy()
  })

  it('says so when the window closed while deciding', async () => {
    stubApi({ 'DELETE /cases/7K3PQ/sightings/s2': { status: 403 } })
    showOwn()
    fireEvent.click(screen.getByRole('button', { name: 'Borrar mi avistamiento' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sí, borrarlo' }))
    expect(await screen.findByText(/ya haya pasado el tiempo/)).toBeTruthy()
  })
})
