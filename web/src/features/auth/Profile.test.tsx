// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderWithQuery, stubApi } from '../../test-utils'
import { Profile } from './Profile'

const caro = {
  display_name: 'Carolina Mejía',
  email: 'caro@correo.co',
  phone: '+573001234567',
  city: 'Medellín',
  bio: null,
  notification_prefs: { lost: true, found: true, adoption: true, help: true },
}

const type = (label: RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } })

describe('Profile', () => {
  it('shows who is signed in, with which email and phone, and what can be edited', async () => {
    stubApi({ 'GET /me/profile': { body: caro } })
    renderWithQuery(<Profile />)
    expect(await screen.findByRole('heading', { name: 'Carolina Mejía' })).toBeTruthy()
    expect(screen.getByText('CM')).toBeTruthy()
    expect(screen.getByText('caro@correo.co')).toBeTruthy()
    expect(screen.getByText('+573001234567')).toBeTruthy()
    expect((screen.getByLabelText(/Tu nombre/) as HTMLInputElement).value).toBe('Carolina Mejía')
    expect((screen.getByLabelText(/Ciudad/) as HTMLInputElement).value).toBe('Medellín')
    expect((screen.getByRole('switch', { name: /Adopción/ }) as HTMLInputElement).checked).toBe(
      true,
    )
    // Nothing changed yet: nothing to save.
    expect(
      (screen.getByRole('button', { name: 'Guardar cambios' }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it('asks for a phone only when there is none yet', async () => {
    stubApi({ 'GET /me/profile': { body: { ...caro, phone: null } } })
    renderWithQuery(<Profile />)
    expect(await screen.findByText(/Te pediremos un celular/)).toBeTruthy()
  })

  it('saves only what changed', async () => {
    const calls = stubApi({
      'GET /me/profile': { body: caro },
      'PATCH /me/profile': {
        body: {
          ...caro,
          display_name: 'Caro M.',
          bio: 'Rescatista en Laureles.',
          notification_prefs: { ...caro.notification_prefs, adoption: false },
        },
      },
    })
    renderWithQuery(<Profile />)
    await screen.findByRole('heading', { name: 'Carolina Mejía' })

    type(/Tu nombre/, 'Caro M. ')
    type(/Sobre ti/, 'Rescatista en Laureles.')
    fireEvent.click(screen.getByRole('switch', { name: /Adopción/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))

    expect(await screen.findByText('Guardamos tus cambios.')).toBeTruthy()
    expect(calls.find((c) => c.key === 'PATCH /me/profile')?.body).toEqual({
      display_name: 'Caro M.',
      bio: 'Rescatista en Laureles.',
      notification_prefs: { lost: true, found: true, adoption: false, help: true },
    })
    expect(screen.getByRole('heading', { name: 'Caro M.' })).toBeTruthy()
  })

  it('advises against a link in the bio before sending it', async () => {
    const calls = stubApi({ 'GET /me/profile': { body: caro } })
    renderWithQuery(<Profile />)
    await screen.findByRole('heading', { name: 'Carolina Mejía' })

    type(/Sobre ti/, 'Escríbeme a wa.me/573001234567')
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))

    expect(screen.getByRole('alert').textContent).toMatch(/Quita los enlaces/)
    expect(calls.some((c) => c.key === 'PATCH /me/profile')).toBe(false)
  })

  it('renders the server refusing the bio on the bio', async () => {
    stubApi({
      'GET /me/profile': { body: caro },
      'PATCH /me/profile': {
        status: 422,
        body: { error: { code: 'validation_failed', message: 'x', fields: { bio: 'links' } } },
      },
    })
    renderWithQuery(<Profile />)
    await screen.findByRole('heading', { name: 'Carolina Mejía' })

    type(/Sobre ti/, 'Mi perfil en otra red')
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/solo se permite texto/)
    expect(screen.getByLabelText(/Sobre ti/).getAttribute('aria-invalid')).toBe('true')
    expect(screen.queryByText('No pudimos guardarlo.')).toBeNull()
  })

  it('says so when saving fails for another reason', async () => {
    stubApi({ 'GET /me/profile': { body: caro }, 'PATCH /me/profile': { status: 500 } })
    renderWithQuery(<Profile />)
    await screen.findByRole('heading', { name: 'Carolina Mejía' })

    type(/Ciudad/, 'Envigado')
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))

    expect(await screen.findByText('No pudimos guardarlo.')).toBeTruthy()
  })

  it('shows a loading state, then an error with a retry', async () => {
    let answer = { status: 500 } as { status: number; body?: unknown }
    stubApi({ 'GET /me/profile': () => answer })
    renderWithQuery(<Profile />)
    expect(screen.getByRole('status', { name: 'Cargando tu perfil' })).toBeTruthy()

    expect(await screen.findByRole('heading', { name: 'No pudimos cargar tu perfil' })).toBeTruthy()
    answer = { status: 200, body: caro }
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByRole('heading', { name: 'Carolina Mejía' })).toBeTruthy()
  })

  it('signs out', async () => {
    const calls = stubApi({
      'GET /me/profile': { body: caro },
      'POST /auth/sign-out': { status: 204 },
    })
    renderWithQuery(<Profile />)
    await screen.findByRole('heading', { name: 'Carolina Mejía' })
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }))
    await waitFor(() => expect(calls.some((c) => c.key === 'POST /auth/sign-out')).toBe(true))
  })
})
