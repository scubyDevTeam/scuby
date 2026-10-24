// @vitest-environment jsdom
import type { User } from '@contracts/session'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithQuery, stubApi } from '../../test-utils'
import { PublishFound } from './PublishFound'
import { WitnessReport } from './WitnessReport'

// jsdom has no canvas: the re-encoder is replaced, the upload still goes through the fake API.
vi.mock('@platform/image', () => ({
  prepareImage: async (file: Blob) => file,
  sha256Hex: async () => 'a'.repeat(64),
}))

const veteran: User = {
  id: 'u1',
  displayName: 'Ana',
  email: 'ana@correo.co',
  phone: '+573007152284',
}
const luna = {
  code: '7K3PQ',
  name: 'Luna',
  photo_url: null,
  why: ['Misma especie', 'A 400 m de donde se perdió'],
}

type Routes = Parameters<typeof stubApi>[0]

function withDevice(routes: Routes) {
  const calls = stubApi({
    'POST /uploads': { status: 201, body: { url: 'photo-1.jpg', upload: null } },
    ...routes,
  })
  vi.stubGlobal('navigator', {
    geolocation: {
      getCurrentPosition: (ok: (p: unknown) => void) =>
        ok({ coords: { latitude: 6.2447, longitude: -75.5916 } }),
    },
  })
  return calls
}

async function addPhoto() {
  const file = new File(['x'], 'animal.png', { type: 'image/png' })
  fireEvent.change(screen.getByLabelText(/Agregar foto/), { target: { files: [file] } })
  await screen.findByRole('img', { name: 'Foto 1' })
}

const posts = (calls: ReturnType<typeof stubApi>, path: string) =>
  calls.filter((c) => c.key === `POST ${path}`)

describe('PublishFound — 05 · match first, then create', () => {
  function show(routes: Routes) {
    const calls = withDevice(routes)
    const onExit = vi.fn()
    renderWithQuery(
      <PublishFound
        user={veteran}
        mapStyleUrl={undefined}
        demoCode="123456"
        legal={null}
        onExit={onExit}
        caseLink={(code, children) => <a href={`/c/${code}`}>{children}</a>}
      />,
    )
    return { calls, onExit }
  }

  async function describeAndPlace() {
    await addPhoto()
    fireEvent.click(screen.getByRole('button', { name: 'Perro' }))
    fireEvent.click(screen.getByRole('button', { name: 'Mediano' }))
    fireEvent.change(screen.getByLabelText(/Guarda un dato/), { target: { value: 'Collar verde' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Usar mi ubicación' }))
    await screen.findByText('Zona marcada.')
    fireEvent.change(screen.getByLabelText('Hora aproximada'), { target: { value: '00:01' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }))
  }

  it('requires a photo and asks for no name', () => {
    show({})
    expect(screen.queryByLabelText('Nombre')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }))
    expect(screen.getAllByRole('alert')[0]?.textContent).toBe('Agrega al menos una foto')
  })

  it('with no match, publishes the found case with the withheld detail, in-app only', async () => {
    const { calls } = show({
      'POST /matches': { body: { candidates: [] } },
      'POST /found-cases': { status: 201, body: { code: 'F0UND' } },
    })
    await describeAndPlace()
    fireEvent.click(await screen.findByRole('button', { name: 'Publicar y avisar a los vecinos' }))

    expect(await screen.findByText('¡Aviso publicado!')).toBeTruthy()
    expect(posts(calls, '/found-cases')[0]?.body).toMatchObject({
      withheld_detail: 'Collar verde',
      holding_where: 'home',
      contact_prefs: { expose_whatsapp: false, in_app_only: true },
    })
  })

  it('on a match the custodian confirms, and a claim on the lost case replaces the found case', async () => {
    const { calls } = show({
      'POST /matches': { body: { candidates: [luna] } },
      'POST /cases/7K3PQ/recovery-claims': { status: 201, body: { id: 'c1', whatsapp_url: null } },
    })
    vi.stubGlobal('open', vi.fn())
    await describeAndPlace()

    expect(await screen.findByRole('heading', { name: '¿Es alguno de estos?' })).toBeTruthy()
    expect(screen.getByText('Misma especie · A 400 m de donde se perdió')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Sí, es Luna' }))
    fireEvent.change(await screen.findByLabelText('Tu celular'), {
      target: { value: '3007152284' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Avisar y abrir WhatsApp/ }))

    expect(await screen.findByText('Ya le avisamos a su familia.')).toBeTruthy()
    expect(posts(calls, '/cases/7K3PQ/recovery-claims')).toHaveLength(1)
    expect(posts(calls, '/found-cases')).toEqual([])
  })

  it('«no es ninguno» goes on to publish', async () => {
    show({ 'POST /matches': { body: { candidates: [luna] } } })
    await describeAndPlace()
    fireEvent.click(await screen.findByRole('button', { name: 'No es ninguno, publicar mi aviso' }))
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('¿Cómo te avisan?')
  })

  it('matching being down does not block publishing', async () => {
    show({ 'POST /matches': { status: 500 } })
    await describeAndPlace()
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('¿Cómo te avisan?'),
    )
  })
})

describe('WitnessReport — 05 · «no lo tengo, solo lo vi»', () => {
  function show(routes: Routes) {
    const calls = withDevice(routes)
    renderWithQuery(<WitnessReport mapStyleUrl={undefined} onDone={() => {}} />)
    return calls
  }

  async function fill() {
    await addPhoto()
    fireEvent.click(screen.getByRole('button', { name: 'Gato' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Usar mi ubicación' }))
    await screen.findByText('Punto marcado.')
    fireEvent.click(screen.getByRole('button', { name: 'Enviar reporte' }))
  }

  it('does not send without a photo: it could not be matched to anything', () => {
    const calls = show({})
    fireEvent.click(screen.getByRole('button', { name: 'Enviar reporte' }))
    expect(screen.getAllByRole('alert')[0]?.textContent).toBe('Agrega al menos una foto')
    expect(posts(calls, '/matches')).toEqual([])
  })

  it('with no match, keeps the report as an orphan', async () => {
    const calls = show({
      'POST /matches': { body: { candidates: [] } },
      'POST /sightings': { status: 201, body: { id: 'o1' } },
    })
    await fill()
    expect(await screen.findByText('Guardamos tu reporte.')).toBeTruthy()
    expect(posts(calls, '/sightings')[0]?.body).toMatchObject({
      species: 'cat',
      photo_urls: ['photo-1.jpg'],
    })
  })

  it('on a match the witness confirms, and the sighting joins that case', async () => {
    const calls = show({
      'POST /matches': { body: { candidates: [luna] } },
      'POST /cases/7K3PQ/sightings': { status: 201, body: { id: 's9' } },
    })
    await fill()
    fireEvent.click(await screen.findByRole('button', { name: 'Sí, es Luna' }))
    expect(await screen.findByText('Guardamos tu reporte.')).toBeTruthy()
    expect(posts(calls, '/cases/7K3PQ/sightings')).toHaveLength(1)
    expect(posts(calls, '/sightings')).toEqual([])
  })

  it('«no es ninguno» keeps it as an orphan — never attached by itself', async () => {
    const calls = show({
      'POST /matches': { body: { candidates: [luna] } },
      'POST /sightings': { status: 201, body: { id: 'o1' } },
    })
    await fill()
    fireEvent.click(await screen.findByRole('button', { name: 'No es ninguno' }))
    await screen.findByText('Guardamos tu reporte.')
    expect(posts(calls, '/cases/7K3PQ/sightings')).toEqual([])
    expect(posts(calls, '/sightings')).toHaveLength(1)
  })
})
