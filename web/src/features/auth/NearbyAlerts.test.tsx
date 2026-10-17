// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { renderWithQuery, stubApi } from '../../test-utils'
import { NearbyAlerts } from './NearbyAlerts'

beforeAll(() => {
  // jsdom has no modal dialogs yet.
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.open = true
  }
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.open = false
  }
})

const off = { enabled: false, center: null, radius_km: 2, place_name: null }
const on = {
  enabled: true,
  center: { lat: 6.2447, lng: -75.5916 },
  radius_km: 2,
  place_name: 'Laureles',
}

/** Without map tiles the zone is placed from the device's location. */
function show(current: unknown, routes: Parameters<typeof stubApi>[0] = {}) {
  const calls = stubApi({ 'GET /me/nearby-alerts': { body: current }, ...routes })
  vi.stubGlobal('navigator', {
    geolocation: {
      getCurrentPosition: (ok: (p: unknown) => void) =>
        ok({ coords: { latitude: 6.2447, longitude: -75.5916 } }),
    },
  })
  renderWithQuery(<NearbyAlerts mapStyleUrl={undefined} />)
  return calls
}

describe('NearbyAlerts — «Mascotas perdidas cerca de mí» (08)', () => {
  it('off: says what it is and offers to turn it on', async () => {
    show(off)
    expect(await screen.findByText('Mascotas perdidas cerca de mí')).toBeTruthy()
    expect(screen.getByText(/una notificación por cada mascota perdida cerca/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Activar alertas' })).toBeTruthy()
  })

  it('on: names the zone and offers to change or turn it off', async () => {
    show(on)
    expect(await screen.findByText(/cerca de Laureles, unos 2 km alrededor/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Cambiar la zona' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Activar alertas' })).toBeNull()
  })

  it('turning on: the zone is confirmed from the device’s location and saved with its radius', async () => {
    const calls = show(off, {
      'POST /me/nearby-alerts': { body: on },
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Activar alertas' }))
    expect(await screen.findByText('Paso 1 de 1')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '5 km' }))
    fireEvent.click(screen.getByRole('button', { name: 'Usar mi ubicación' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Usar mi ubicación' })).toBeTruthy(),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Listo, avísame' }))

    expect(await screen.findByText('Listo, te avisaremos.')).toBeTruthy()
    expect(calls.find((c) => c.key === 'POST /me/nearby-alerts')?.body).toEqual({
      enabled: true,
      center: { lat: 6.2447, lng: -75.5916 },
      radius_km: 5,
    })
  })

  it('asks for the zone before saving anything', async () => {
    const calls = show(off, { 'POST /me/nearby-alerts': { body: on } })
    fireEvent.click(await screen.findByRole('button', { name: 'Activar alertas' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Listo, avísame' }))
    expect(screen.getByText('Marca tu zona en el mapa o usa tu ubicación.')).toBeTruthy()
    expect(calls.some((c) => c.key.startsWith('POST'))).toBe(false)
  })

  it('says so when the zone could not be saved, and lets it be tried again', async () => {
    show(off, { 'POST /me/nearby-alerts': { status: 500 } })
    fireEvent.click(await screen.findByRole('button', { name: 'Activar alertas' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Usar mi ubicación' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Usar mi ubicación' })).toBeTruthy(),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Listo, avísame' }))
    expect(await screen.findByText(/No pudimos guardar tu zona/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Listo, avísame' })).toBeTruthy()
  })

  it('turning off sends the zone along, so it is kept', async () => {
    const calls = show(on, { 'POST /me/nearby-alerts': { body: { ...on, enabled: false } } })
    fireEvent.click(await screen.findByRole('button', { name: 'Apagar alertas' }))
    await waitFor(() =>
      expect(calls.find((c) => c.key === 'POST /me/nearby-alerts')?.body).toEqual({
        enabled: false,
        center: on.center,
        radius_km: 2,
      }),
    )
    expect(await screen.findByRole('button', { name: 'Activar alertas' })).toBeTruthy()
  })

  it('a failure loading it says so, without breaking the profile', async () => {
    show(null, { 'GET /me/nearby-alerts': { status: 500 } })
    expect(await screen.findByText('No pudimos cargar tus alertas.')).toBeTruthy()
  })
})
