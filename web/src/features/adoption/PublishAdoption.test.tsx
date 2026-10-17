// @vitest-environment jsdom
import { parseCase } from '@contracts/case'
import type { FoundCase } from '@contracts/found'
import type { User } from '@contracts/session'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cases } from '../../mocks/fixtures'
import { renderWithQuery, stubApi } from '../../test-utils'
import { PublishAdoption } from './PublishAdoption'

vi.mock('@platform/image', () => ({ prepareImage: async (file: Blob) => file }))

const veteran: User = {
  id: 'u1',
  displayName: 'Ana',
  email: 'ana@correo.co',
  phone: '+573007152284',
}

// Each form starts empty: a draft kept by an earlier test would open in its place.
beforeEach(() => localStorage.clear())

function show(fromFound: FoundCase | null = null) {
  const calls = stubApi({
    'POST /uploads': { status: 201, body: { url: 'photo-1.jpg' } },
    'POST /adoption-cases': { body: { code: 'NEW42' } },
  })
  vi.stubGlobal('navigator', {
    geolocation: {
      getCurrentPosition: (ok: (p: unknown) => void) =>
        ok({ coords: { latitude: 6.2447, longitude: -75.5916 } }),
    },
  })
  renderWithQuery(
    <PublishAdoption
      user={veteran}
      fromFound={fromFound}
      mapStyleUrl={undefined}
      demoCode="123456"
      legal={null}
      onExit={vi.fn()}
      caseLink={(code, children) => <a href={`/c/${code}`}>{children}</a>}
    />,
  )
  return calls
}

const next = () => fireEvent.click(screen.getByRole('button', { name: 'Continuar' }))

async function stepOne() {
  fireEvent.change(screen.getByLabelText('¿Cómo se llama?'), { target: { value: 'Pelusa' } })
  fireEvent.click(screen.getByRole('button', { name: 'Lo rescaté o lo cuido' }))
  const file = new File(['x'], 'pelusa.png', { type: 'image/png' })
  fireEvent.change(screen.getByLabelText(/Agregar foto/), { target: { files: [file] } })
  await screen.findByRole('img', { name: 'Foto 1' })
  fireEvent.click(screen.getByRole('button', { name: 'Gato' }))
  fireEvent.click(screen.getByRole('button', { name: 'Pequeño' }))
  fireEvent.click(screen.getByRole('button', { name: 'VIF / ViLeF' }))
  next()
}

describe('PublishAdoption — 06 · adoption_case', () => {
  it('step 1 asks for a name, a photo, and who the animal is to the lister', () => {
    show()
    next()
    expect(screen.getByText('Dinos cómo se llama')).toBeTruthy()
    expect(screen.getByText('Agrega al menos una foto')).toBeTruthy()
    expect(screen.getByText('Dinos qué es para ti')).toBeTruthy()
  })

  it('publishes with the health flags, the area and the verified number', async () => {
    const calls = show()
    await stepOne()
    fireEvent.change(screen.getByLabelText(/Cuéntanos su historia/), {
      target: { value: 'La rescaté.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Sin salir a la calle' }))
    next()
    fireEvent.click(await screen.findByRole('button', { name: 'Usar mi ubicación' }))
    await screen.findByText('Zona marcada.')
    fireEvent.click(screen.getByRole('button', { name: 'Publicar en adopción' }))
    expect(await screen.findByRole('heading', { name: '¡Publicado en adopción!' })).toBeTruthy()
    const sent = calls.find((c) => c.key === 'POST /adoption-cases')?.body
    expect(sent).toMatchObject({
      from_found_case_code: null,
      lister_role: 'custodian',
      pet: {
        name: 'Pelusa',
        species: 'cat',
        health_flags: ['fiv_felv'],
        photo_urls: ['photo-1.jpg'],
      },
      requirement_flags: ['indoor_only'],
      location_point: { lat: 6.2447, lng: -75.5916 },
      phone: null,
    })
  })

  it('05 · the day-15 conversion arrives pre-filled, on the same pet', async () => {
    const parsed = parseCase(cases('responsible').C4STD)
    if (parsed.vertical !== 'found') throw new Error('found')
    const calls = show(parsed)
    expect(screen.getByText(/Viene de tu aviso/)).toBeTruthy()
    expect(screen.queryByText('¿Qué es para ti?')).toBeNull()
    fireEvent.change(screen.getByLabelText('¿Cómo se llama?'), { target: { value: 'Tito' } })
    next()
    expect((screen.getByLabelText(/Cuéntanos su historia/) as HTMLTextAreaElement).value).toMatch(
      /^Lo encontraron en Estadio el /,
    )
    next()
    fireEvent.click(screen.getByRole('button', { name: 'Publicar en adopción' }))
    await waitFor(() =>
      expect(calls.find((c) => c.key === 'POST /adoption-cases')?.body).toMatchObject({
        from_found_case_code: 'C4STD',
        pet: { name: 'Tito', species: 'dog', size: 'medium' },
      }),
    )
  })
})

describe('the form survives a reload', () => {
  it('opens on what was typed, says so, and «Empezar de nuevo» clears it', async () => {
    show()
    fireEvent.change(await screen.findByLabelText('¿Cómo se llama?'), { target: { value: 'Toby' } })
    cleanup()
    show()
    expect(((await screen.findByLabelText('¿Cómo se llama?')) as HTMLInputElement).value).toBe(
      'Toby',
    )
    expect(screen.getByText('Seguimos donde ibas.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Empezar de nuevo' }))
    expect((screen.getByLabelText('¿Cómo se llama?') as HTMLInputElement).value).toBe('')
  })
})
