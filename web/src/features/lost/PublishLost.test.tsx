// @vitest-environment jsdom
import type { User } from '@contracts/session'
import { cleanup, fireEvent, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithQuery, stubApi } from '../../test-utils'
import { PublishLost } from './PublishLost'

const newcomer: User = { id: 'u1', displayName: 'Juan Pérez', email: 'juan@correo.co', phone: null }
const veteran: User = { ...newcomer, phone: '+573007152284' }
const luna = {
  id: 'pet-luna',
  name: 'Luna',
  species: 'dog',
  size: 'small',
  colors: ['black'],
  marks: 'Collar rojo',
  photo_urls: [],
  active_case_code: null,
}

// Each form starts empty: a draft kept by an earlier test would open in its place.
beforeEach(() => localStorage.clear())

type Routes = Parameters<typeof stubApi>[0]

function show(user: User, routes: Routes = {}) {
  const calls = stubApi({ 'GET /me/pets': { body: [] }, ...routes })
  // No map tiles in a unit test: the zone comes from the device's location.
  vi.stubGlobal('navigator', {
    geolocation: {
      getCurrentPosition: (ok: (p: unknown) => void) =>
        ok({ coords: { latitude: 6.2447, longitude: -75.5916 } }),
    },
  })
  renderWithQuery(
    <PublishLost
      user={user}
      mapStyleUrl={undefined}
      demoCode="123456"
      legal={null}
      onExit={() => {}}
      caseLink={(code, children) => <a href={`/c/${code}`}>{children}</a>}
    />,
  )
  return calls
}

const go = () => fireEvent.click(screen.getByRole('button', { name: 'Continuar' }))
const publishButton = () =>
  screen.getByRole('button', { name: /Publicar y avisar|Confirmar código/ })
const posts = (calls: ReturnType<typeof stubApi>) =>
  calls.filter((c) => c.key === 'POST /lost-cases')

function fillWho() {
  fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Luna' } })
  fireEvent.click(screen.getByRole('button', { name: 'Perro' }))
  fireEvent.click(screen.getByRole('button', { name: 'Pequeño' }))
  fireEvent.click(screen.getByRole('button', { name: 'Negro' }))
  go()
}

async function fillWhere() {
  fireEvent.click(await screen.findByRole('button', { name: 'Usar mi ubicación' }))
  await screen.findByText('Zona marcada.')
  fireEvent.change(screen.getByLabelText('Hora aproximada'), { target: { value: '00:01' } })
  go()
}

describe('PublishLost — 04 · Publishing, step by step', () => {
  it('does not leave step 1 without a name, a species and a size', () => {
    show(newcomer)
    go()
    expect(screen.getAllByRole('alert').map((a) => a.textContent)).toEqual([
      'Dinos cómo se llama',
      'Elige la especie',
      'Elige el tamaño',
    ])
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('¿Quién se perdió?')
  })

  it('does not leave step 2 without a zone', async () => {
    show(newcomer)
    fillWho()
    await screen.findByRole('button', { name: 'Usar mi ubicación' })
    go()
    expect(screen.getByRole('alert').textContent).toBe('Toca el mapa más o menos dónde fue')
  })

  it('asks for an area with a preset radius, 3 blocks unless changed', async () => {
    const calls = show(veteran, { 'POST /lost-cases': { status: 201, body: { code: 'NEW23' } } })
    fillWho()
    fireEvent.click(await screen.findByRole('button', { name: '~1 km' }))
    await fillWhere()
    fireEvent.click(publishButton())

    await screen.findByText('¡Aviso publicado!')
    expect(posts(calls)[0]?.body).toMatchObject({
      last_seen_point: { lat: 6.2447, lng: -75.5916 },
      last_seen_radius_m: 1000,
    })
  })
})

describe('PublishLost — auth.md · the phone step', () => {
  it('a first publish verifies the number by SMS before the case goes live', async () => {
    let attempt = 0
    const calls = show(newcomer, {
      'POST /lost-cases': () =>
        ++attempt === 1
          ? { body: { phone_step: 'otp' } }
          : { status: 201, body: { code: 'NEW23' } },
    })
    fillWho()
    await fillWhere()
    fireEvent.change(await screen.findByLabelText('Tu celular'), {
      target: { value: '300 715 2284' },
    })
    fireEvent.click(publishButton())

    // The server answered `otp`: only now does the form ask for the code.
    fireEvent.change(await screen.findByLabelText('Código que te enviamos por SMS'), {
      target: { value: '123456' },
    })

    expect(await screen.findByText('¡Aviso publicado!')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Ver mi aviso' }).getAttribute('href')).toBe('/c/NEW23')
    const [first, second] = posts(calls).map((c) => c.body as Record<string, unknown>)
    expect(first).toMatchObject({ phone: '+573007152284', otp_code: null })
    expect(second).toMatchObject({ phone: '+573007152284', otp_code: '123456' })
  })

  it('shows no code field until the server asks for one', async () => {
    show(newcomer)
    fillWho()
    await fillWhere()
    await screen.findByLabelText('Tu celular')
    expect(screen.queryByLabelText('Código que te enviamos por SMS')).toBeNull()
  })

  it('a later publish shows the verified number, prefilled, with «Cambiar»', async () => {
    const calls = show(veteran, { 'POST /lost-cases': { status: 201, body: { code: 'NEW23' } } })
    fillWho()
    await fillWhere()

    expect(await screen.findByText('+573007152284')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Cambiar' })).toBeTruthy()
    fireEvent.click(publishButton())
    await screen.findByText('¡Aviso publicado!')
    // Null keeps the account's number: nothing to verify again.
    expect(posts(calls)[0]?.body).toMatchObject({ phone: null })
  })

  it('changing the number asks for it again', async () => {
    show(veteran)
    fillWho()
    await fillWhere()
    fireEvent.click(await screen.findByRole('button', { name: 'Cambiar' }))
    expect(screen.getByLabelText('Tu celular')).toBeTruthy()
  })

  it('does not publish with an invalid number or with every contact channel off', async () => {
    const calls = show(newcomer)
    fillWho()
    await fillWhere()
    fireEvent.change(await screen.findByLabelText('Tu celular'), { target: { value: '123' } })
    fireEvent.click(publishButton())
    expect(screen.getByRole('alert').textContent).toBe('Revisa el número de celular')

    fireEvent.change(screen.getByLabelText('Tu celular'), { target: { value: '3007152284' } })
    fireEvent.click(screen.getByRole('switch', { name: /WhatsApp/ }))
    fireEvent.click(screen.getByRole('switch', { name: /Chat dentro/ }))
    fireEvent.click(publishButton())
    expect(screen.getByRole('alert').textContent).toBe('Deja al menos una forma de contacto activa')
    expect(posts(calls)).toEqual([])
  })
})

describe('PublishLost — 04 · reuse a pet before creating one', () => {
  it('offers the pets the account already has and fills the form from the one chosen', async () => {
    const calls = show(veteran, {
      'GET /me/pets': { body: [luna] },
      'POST /lost-cases': { status: 201, body: { code: 'NEW23' } },
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Luna' }))
    expect((screen.getByLabelText('Nombre') as HTMLInputElement).value).toBe('Luna')
    go()
    await fillWhere()
    fireEvent.click(publishButton())

    await screen.findByText('¡Aviso publicado!')
    expect(posts(calls)[0]?.body).toMatchObject({ pet_id: 'pet-luna' })
  })

  it('blocks a pet that already has an active case and links to it', async () => {
    show(veteran, { 'GET /me/pets': { body: [{ ...luna, active_case_code: '7K3PQ' }] } })
    fireEvent.click(await screen.findByRole('button', { name: 'Luna' }))

    expect(screen.getByText('Luna ya tiene un aviso activo.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Ver ese aviso' }).getAttribute('href')).toBe(
      '/c/7K3PQ',
    )
    go()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('¿Quién se perdió?')
  })

  it('offers to reactivate an expired notice, and reactivating shows it again', async () => {
    const calls = show(veteran, {
      'GET /me/pets': { body: [{ ...luna, reopenable_case_code: 'ARCH2' }] },
      'POST /cases/ARCH2/reopen': { status: 201, body: { id: 'x' } },
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Luna' }))
    expect(screen.getByText('Luna ya tenía un aviso')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Reactivar el aviso de Luna' }))

    expect(await screen.findByText('Listo, el aviso de Luna está activo de nuevo.')).toBeTruthy()
    expect(calls.some((c) => c.key === 'POST /cases/ARCH2/reopen')).toBe(true)
    expect(screen.getByRole('link', { name: 'Ver ese aviso' }).getAttribute('href')).toBe(
      '/c/ARCH2',
    )
  })

  it('says so when it cannot be reactivated, leaving the new notice possible', async () => {
    show(veteran, {
      'GET /me/pets': { body: [{ ...luna, reopenable_case_code: 'ARCH2' }] },
      'POST /cases/ARCH2/reopen': { status: 409 },
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Luna' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reactivar el aviso de Luna' }))
    expect(await screen.findByText(/No pudimos reactivarlo/)).toBeTruthy()
    go()
    expect(screen.getByRole('heading', { level: 1 }).textContent).not.toBe('¿Quién se perdió?')
  })

  it('offers nothing for a pet with no expired notice', async () => {
    show(veteran, { 'GET /me/pets': { body: [luna] } })
    fireEvent.click(await screen.findByRole('button', { name: 'Luna' }))
    expect(screen.queryByText('Luna ya tenía un aviso')).toBeNull()
  })
})

describe('PublishLost — the form survives a reload', () => {
  it('opens on what was typed, says so, and «Empezar de nuevo» clears it', async () => {
    show(newcomer)
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Toby' } })
    cleanup()
    show(newcomer)
    expect((screen.getByLabelText('Nombre') as HTMLInputElement).value).toBe('Toby')
    expect(screen.getByText('Seguimos donde ibas.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Empezar de nuevo' }))
    expect((screen.getByLabelText('Nombre') as HTMLInputElement).value).toBe('')
  })
})
