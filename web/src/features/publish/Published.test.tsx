// @vitest-environment jsdom
import { fireEvent, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithQuery, stubApi } from '../../test-utils'
import { Published } from './parts'

// The device is the platform's business; here it is whatever each test says it is.
const device = vi.hoisted(() => ({
  pushSupport: vi.fn(),
  pushPermission: vi.fn(),
  installHintShown: vi.fn(),
  markInstallHintShown: vi.fn(),
  subscribePush: vi.fn(),
}))
vi.mock('@platform/push', () => device)

const TOKEN = '{"endpoint":"https://push.example.test/s/1"}'
const REGISTER = 'POST /me/push-subscriptions'

function given(support: string, permission = 'default', hintShown = false) {
  device.pushSupport.mockReturnValue(support)
  device.pushPermission.mockReturnValue(permission)
  device.installHintShown.mockReturnValue(hintShown)
}

function show(status = 201) {
  const calls = stubApi({ [REGISTER]: { status, body: { id: 'push-1' } } })
  renderWithQuery(
    <Published
      title="¡Aviso publicado!"
      notice={null}
      link={<a href="/c/NEW23">Ver mi aviso</a>}
    />,
  )
  return calls
}

const enable = () => fireEvent.click(screen.getByRole('button', { name: 'Activar avisos' }))

beforeEach(() => {
  vi.clearAllMocks()
  device.subscribePush.mockResolvedValue({ kind: 'webpush', token: TOKEN })
})

describe('Published — frontend.md · Push: the moment to ask is after publishing', () => {
  it('offers notifications next to the link to the case, without asking on its own', () => {
    given('available')
    show()
    expect(screen.getByRole('heading', { name: '¿Te avisamos en este teléfono?' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Ver mi aviso' })).toBeTruthy()
    expect(device.subscribePush).not.toHaveBeenCalled()
  })

  it('registers this install as webpush once permission is given', async () => {
    given('available')
    const calls = show()
    enable()
    expect(await screen.findByText('Listo: te avisaremos en este teléfono.')).toBeTruthy()
    expect(calls.filter((c) => c.key === REGISTER).map((c) => c.body)).toEqual([
      { kind: 'webpush', token: TOKEN, device: null },
    ])
  })

  it('says where the news will go instead when notifications are blocked', async () => {
    given('available')
    device.subscribePush.mockResolvedValue('denied')
    const calls = show()
    enable()
    expect(await screen.findByText(/Te contaremos todo por correo y en tu Bandeja/)).toBeTruthy()
    expect(calls.some((c) => c.key === REGISTER)).toBe(false)
  })

  it('keeps the offer when the permission prompt is closed without an answer', async () => {
    given('available')
    device.subscribePush.mockResolvedValue('dismissed')
    show()
    enable()
    expect(await screen.findByRole('button', { name: 'Activar avisos' })).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('lets the person try again when the registration fails', async () => {
    given('available')
    show(500)
    enable()
    expect((await screen.findByRole('alert')).textContent).toBe(
      'No pudimos activar los avisos. Inténtalo de nuevo.',
    )
    expect(screen.getByRole('button', { name: 'Activar avisos' })).toBeTruthy()
  })

  it('goes away with «Ahora no»', () => {
    given('available')
    show()
    fireEvent.click(screen.getByRole('button', { name: 'Ahora no' }))
    expect(screen.queryByRole('button', { name: 'Activar avisos' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Ver mi aviso' })).toBeTruthy()
  })

  it('registers quietly when permission was given before: nothing to ask', async () => {
    given('available', 'granted')
    const calls = show()
    await vi.waitFor(() => expect(calls.some((c) => c.key === REGISTER)).toBe(true))
    expect(screen.queryByRole('button', { name: 'Activar avisos' })).toBeNull()
  })

  it('offers nothing where push is off', () => {
    given('unavailable')
    show()
    expect(screen.queryByRole('button', { name: 'Activar avisos' })).toBeNull()
    expect(screen.queryByText(/pantalla de inicio/)).toBeNull()
  })
})

describe('Published — iOS in a Safari tab: the add-to-home-screen instruction', () => {
  it('shows it instead of asking, once, and lets it be dismissed', () => {
    given('needs_install')
    show()
    expect(
      screen.getByText(
        'Para recibir avisos en iPhone: toca Compartir → Añadir a pantalla de inicio, y abre la app desde ahí.',
      ),
    ).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Activar avisos' })).toBeNull()
    expect(device.markInstallHintShown).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Entendido' }))
    expect(screen.queryByText(/pantalla de inicio/)).toBeNull()
  })

  it('does not show it again', () => {
    given('needs_install', 'default', true)
    show()
    expect(screen.queryByText(/pantalla de inicio/)).toBeNull()
  })
})
