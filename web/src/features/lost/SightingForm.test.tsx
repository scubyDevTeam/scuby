// @vitest-environment jsdom

import type { Sighting } from '@contracts/case'
import { onlineManager } from '@tanstack/react-query'
import { fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithQuery, stubApi } from '../../test-utils'
import { SightingForm } from './SightingForm'

const lastSeenPoint = { lat: 6.2447, lng: -75.5916 }
const nearby = { latitude: 6.2467, longitude: -75.5916 }
const bogota = { latitude: 4.711, longitude: -74.0721 }

// The queue keeps unsent sightings in this device's storage: each test starts with none.
beforeEach(() => localStorage.clear())
afterEach(() => onlineManager.setOnline(true))

/** The device's radio: `navigator.onLine` and the event the browser fires with it. */
function signal(online: boolean) {
  vi.stubGlobal('navigator', { ...navigator, onLine: online })
  window.dispatchEvent(new Event(online ? 'online' : 'offline'))
}

/** Without map tiles the form places the pin from the device's location. */
function show(coords: typeof nearby | null, routes: Parameters<typeof stubApi>[0] = {}) {
  const calls = stubApi({
    'POST /cases/7K3PQ/sightings': { status: 201, body: { id: 's9' } },
    ...routes,
  })
  vi.stubGlobal('navigator', {
    geolocation: {
      getCurrentPosition: (ok: (p: unknown) => void, fail: () => void) =>
        coords ? ok({ coords }) : fail(),
    },
  })
  renderWithQuery(
    <SightingForm
      code="7K3PQ"
      petName="Luna"
      lastSeenPoint={lastSeenPoint}
      lastSeenAt={new Date(Date.now() - 2 * 86_400_000)}
      area={{ center: lastSeenPoint, radiusM: 200 }}
      mapStyleUrl={undefined}
      onDone={() => {}}
    />,
  )
  return calls
}

const locate = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Usar mi ubicación' }))
  await screen.findByRole('button', { name: 'Usar mi ubicación' })
}
const send = () => fireEvent.click(screen.getByRole('button', { name: 'Enviar avistamiento' }))
const posted = (calls: ReturnType<typeof stubApi>) => calls.filter((c) => c.key.startsWith('POST'))

describe('SightingForm — 04 · only the pin is required', () => {
  it('sends a bare pin, seen now, with no contact', async () => {
    const calls = show(nearby)
    await locate()
    await screen.findByText('Punto marcado.')
    send()

    expect(await screen.findByText('¡Gracias!')).toBeTruthy()
    const body = posted(calls)[0]?.body as Record<string, unknown>
    expect(body.point).toEqual({ lat: nearby.latitude, lng: nearby.longitude })
    expect(body.note).toBeNull()
    expect(body.contact_phone).toBeNull()
    expect(Date.now() - new Date(String(body.seen_at)).getTime()).toBeLessThan(60_000)
  })

  it('sends the note, the contact and an earlier time when given', async () => {
    const calls = show(nearby)
    await locate()
    await screen.findByText('Punto marcado.')
    fireEvent.click(screen.getByRole('button', { name: 'Ayer' }))
    fireEvent.change(screen.getByLabelText(/Nota/), { target: { value: 'Iba hacia el parque' } })
    fireEvent.change(await screen.findByLabelText(/Tu WhatsApp/), {
      target: { value: '311 482 9017' },
    })
    send()

    await screen.findByText('¡Gracias!')
    const body = posted(calls)[0]?.body as Record<string, unknown>
    expect(body.note).toBe('Iba hacia el parque')
    expect(body.contact_phone).toBe('+573114829017')
    const hoursAgo = (Date.now() - new Date(String(body.seen_at)).getTime()) / 3_600_000
    expect(hoursAgo).toBeCloseTo(24, 0)
  })

  it('does not send without a pin, and says what is missing', () => {
    const calls = show(nearby)
    send()
    expect(screen.getByRole('alert').textContent).toBe('Marca en el mapa dónde viste a Luna')
    expect(posted(calls)).toEqual([])
  })

  it('says so the moment the pin lands too far away, with the doc copy', async () => {
    const calls = show(bogota)
    await locate()
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Ese punto está muy lejos del último lugar donde se vio a Luna',
    )
    send()
    expect(posted(calls)).toEqual([])
  })

  it('rejects a time in the future', async () => {
    const calls = show(nearby)
    await locate()
    fireEvent.click(screen.getByRole('button', { name: 'Otra hora' }))
    fireEvent.change(screen.getByLabelText('Día y hora'), { target: { value: '2999-01-01T10:00' } })
    expect(screen.getByRole('alert').textContent).toBe('La hora no puede ser en el futuro')
    send()
    expect(posted(calls)).toEqual([])
  })

  it('a wrong optional phone blocks the send instead of being dropped silently', async () => {
    const calls = show(nearby)
    await locate()
    fireEvent.change(await screen.findByLabelText(/Tu WhatsApp/), { target: { value: '123' } })
    send()
    expect(screen.getByRole('alert').textContent).toBe('Revisa el número de celular')
    expect(posted(calls)).toEqual([])
  })

  it('explains a denied location instead of failing', async () => {
    show(null)
    await locate()
    expect(screen.getByText(/No pudimos obtener tu ubicación/)).toBeTruthy()
  })

  it('shows the rate-limit copy when the server refuses', async () => {
    show(nearby, { 'POST /cases/7K3PQ/sightings': { status: 429 } })
    await locate()
    await screen.findByText('Punto marcado.')
    send()
    expect(await screen.findByText('Ya registraste un avistamiento hace poco.')).toBeTruthy()
  })

  it('with no signal it is kept, calmly — «Guardamos tu avistamiento» — and goes by itself', async () => {
    const calls = show(nearby)
    await locate()
    await screen.findByText('Punto marcado.')
    signal(false)
    send()

    expect(await screen.findByText('Guardamos tu avistamiento')).toBeTruthy()
    expect(screen.getByText(/No tienes que repetirlo/)).toBeTruthy()
    expect(screen.getByText('Sin conexión')).toBeTruthy()
    expect(screen.getByText(/^Viste a Luna · /)).toBeTruthy()
    expect(screen.getByText('En espera')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Volver al aviso de Luna' })).toBeTruthy()
    expect(screen.queryByText('No pudimos enviar tu avistamiento.')).toBeNull()
    expect(posted(calls)).toEqual([])

    signal(true)
    expect(await screen.findByText('¡Gracias!')).toBeTruthy()
    expect(posted(calls)).toHaveLength(1)
    expect((posted(calls)[0]?.body as Record<string, unknown> | undefined)?.client_id).toEqual(
      expect.any(String),
    )
  })
})

describe('SightingForm — your own pin (04 · Second pin, Correction window)', () => {
  const own: Sighting = {
    id: 's9',
    point: { lat: 6.2461, lng: -75.5899 },
    seenAt: new Date(Date.now() - 5 * 60_000),
    note: 'Cerca del parque',
    photoUrls: [],
    source: 'anonymous',
    highlightedByOwner: false,
    contactPhone: null,
    hidden: false,
    mine: true,
    editableUntil: new Date(Date.now() + 10 * 60_000),
  }

  function open(
    props: { correcting?: Sighting; ownPin?: Sighting },
    routes: Parameters<typeof stubApi>[0] = {},
  ) {
    const calls = stubApi({
      'POST /cases/7K3PQ/sightings': { status: 201, body: { id: 's10' } },
      'POST /cases/7K3PQ/sightings/s9/correction': { status: 204 },
      ...routes,
    })
    vi.stubGlobal('navigator', {
      geolocation: {
        getCurrentPosition: (ok: (p: unknown) => void) => ok({ coords: nearby }),
      },
    })
    renderWithQuery(
      <SightingForm
        code="7K3PQ"
        petName="Luna"
        lastSeenPoint={lastSeenPoint}
        lastSeenAt={new Date(Date.now() - 2 * 86_400_000)}
        area={{ center: lastSeenPoint, radiusM: 200 }}
        mapStyleUrl={undefined}
        onDone={() => {}}
        {...props}
      />,
    )
    return calls
  }

  it('correcting opens on the pin, with its note, and has no number to ask for', async () => {
    open({ correcting: own })
    expect(screen.getByText(/No creamos un avistamiento nuevo/)).toBeTruthy()
    expect((screen.getByLabelText(/Nota/) as HTMLTextAreaElement).value).toBe('Cerca del parque')
    expect(screen.queryByLabelText(/Tu WhatsApp/)).toBeNull()
    expect(screen.getByText('Punto marcado.')).toBeTruthy()
  })

  it('«Guardar corrección» moves the pin: one correction, no new sighting', async () => {
    const calls = open({ correcting: own })
    fireEvent.change(screen.getByLabelText(/Nota/), { target: { value: 'Más hacia la 70' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar corrección' }))

    expect(await screen.findByText('Listo, corregimos tu avistamiento.')).toBeTruthy()
    expect(calls.map((c) => c.key).filter((k) => k.startsWith('POST'))).toEqual([
      'POST /cases/7K3PQ/sightings/s9/correction',
    ])
    const body = calls.find((c) => c.key.endsWith('/correction'))?.body as Record<string, unknown>
    expect(body.point).toEqual(own.point)
    expect(body.note).toBe('Más hacia la 70')
  })

  it('says so when the window closed in the meantime', async () => {
    open({ correcting: own }, { 'POST /cases/7K3PQ/sightings/s9/correction': { status: 403 } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar corrección' }))
    expect(await screen.findByText(/ya haya pasado el tiempo/)).toBeTruthy()
  })

  it('a second pin asks before saving, and «Lo vi otra vez» creates a new sighting', async () => {
    const calls = open({ ownPin: own })
    await locate()
    await screen.findByText('Punto marcado.')
    send()

    expect(
      await screen.findByText('¿Lo viste otra vez, o quieres corregir el punto anterior?'),
    ).toBeTruthy()
    expect(posted(calls)).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Lo vi otra vez' }))
    expect(await screen.findByText('¡Gracias!')).toBeTruthy()
    expect(posted(calls).map((c) => c.key)).toEqual(['POST /cases/7K3PQ/sightings'])
  })

  it('«Corregir» moves the earlier pin to the new point instead', async () => {
    const calls = open({ ownPin: own })
    await locate()
    await screen.findByText('Punto marcado.')
    send()
    fireEvent.click(await screen.findByRole('button', { name: 'Corregir' }))

    expect(await screen.findByText('Listo, corregimos tu avistamiento.')).toBeTruthy()
    expect(posted(calls).map((c) => c.key)).toEqual(['POST /cases/7K3PQ/sightings/s9/correction'])
    expect((posted(calls)[0]!.body as { point: unknown }).point).toEqual({
      lat: nearby.latitude,
      lng: nearby.longitude,
    })
  })

  it('without an earlier pin of yours there is no question', async () => {
    const calls = open({})
    await locate()
    await screen.findByText('Punto marcado.')
    send()
    expect(await screen.findByText('¡Gracias!')).toBeTruthy()
    expect(posted(calls)).toHaveLength(1)
  })
})
