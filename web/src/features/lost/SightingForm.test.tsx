// @vitest-environment jsdom
import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithQuery, stubApi } from '../../test-utils'
import { SightingForm } from './SightingForm'

const lastSeenPoint = { lat: 6.2447, lng: -75.5916 }
const nearby = { latitude: 6.2467, longitude: -75.5916 }
const bogota = { latitude: 4.711, longitude: -74.0721 }

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
})
