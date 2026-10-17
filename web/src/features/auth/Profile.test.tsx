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
    expect(await screen.findByText(/Aún no tienes un celular verificado/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Agregar celular' })).toBeTruthy()
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

describe('Profile — «Eliminar mi cuenta» (O15)', () => {
  const open = async (routes: Parameters<typeof stubApi>[0] = {}) => {
    const calls = stubApi({ 'GET /me/profile': { body: caro }, ...routes })
    renderWithQuery(<Profile />)
    fireEvent.click(await screen.findByRole('button', { name: 'Eliminar mi cuenta' }))
    return calls
  }

  it('asks once, saying what happens, before deleting anything', async () => {
    const calls = await open({ 'DELETE /me': { status: 204 } })
    expect(screen.getByText(/Cierra tus avisos activos/)).toBeTruthy()
    expect(calls.some((c) => c.key === 'DELETE /me')).toBe(false)
  })

  it('«No, conservarla» goes back without deleting', async () => {
    const calls = await open({ 'DELETE /me': { status: 204 } })
    fireEvent.click(screen.getByRole('button', { name: 'No, conservarla' }))
    expect(screen.getByRole('button', { name: 'Eliminar mi cuenta' })).toBeTruthy()
    expect(calls.some((c) => c.key === 'DELETE /me')).toBe(false)
  })

  it('confirming deletes the account', async () => {
    const calls = await open({ 'DELETE /me': { status: 204 } })
    fireEvent.click(screen.getByRole('button', { name: 'Sí, eliminar mi cuenta' }))
    await waitFor(() => expect(calls.some((c) => c.key === 'DELETE /me')).toBe(true))
  })

  it('says so when it could not, and lets it be tried again', async () => {
    await open({ 'DELETE /me': { status: 500 } })
    fireEvent.click(screen.getByRole('button', { name: 'Sí, eliminar mi cuenta' }))
    expect(await screen.findByText(/No pudimos eliminar tu cuenta/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Sí, eliminar mi cuenta' })).toBeTruthy()
  })
})

describe('Profile — changing the phone outside a publish (auth.md · Phone)', () => {
  const verified = { ...caro, phone: '+573009998877' }
  const open = async (routes: Parameters<typeof stubApi>[0] = {}) => {
    const calls = stubApi({
      'GET /me/profile': { body: caro },
      'POST /me/phone': { status: 204 },
      'POST /me/phone/verify': { body: verified },
      ...routes,
    })
    renderWithQuery(<Profile demoCode="123456" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Cambiar' }))
    // The country's prefix arrives with the config: the number is read against it.
    await screen.findByText('+57')
    return calls
  }

  it('sends the code to the new number, and the six digits verify it', async () => {
    const calls = await open()
    type(/Tu nuevo celular/, '300 999 8877')
    fireEvent.click(screen.getByRole('button', { name: 'Enviarme el código' }))
    expect(await screen.findByText(/Te lo enviamos por SMS al \+573009998877/)).toBeTruthy()
    expect(calls.find((c) => c.key === 'POST /me/phone')?.body).toEqual({ phone: '+573009998877' })

    type(/Código de 6 dígitos/, '123456')
    expect(await screen.findByText('Listo, tu celular quedó verificado.')).toBeTruthy()
    expect(calls.find((c) => c.key === 'POST /me/phone/verify')?.body).toEqual({
      phone: '+573009998877',
      code: '123456',
    })
  })

  it('refuses a number that is not a mobile, before sending anything', async () => {
    const calls = await open()
    type(/Tu nuevo celular/, '123')
    fireEvent.click(screen.getByRole('button', { name: 'Enviarme el código' }))
    expect(screen.getByText('Escribe un celular válido.')).toBeTruthy()
    expect(calls.some((c) => c.key === 'POST /me/phone')).toBe(false)
  })

  it('says when the code is wrong', async () => {
    await open({ 'POST /me/phone/verify': { status: 422 } })
    type(/Tu nuevo celular/, '300 999 8877')
    fireEvent.click(screen.getByRole('button', { name: 'Enviarme el código' }))
    type(
      await screen.findByLabelText(/Código de 6 dígitos/).then(() => /Código de 6 dígitos/),
      '000000',
    )
    expect(await screen.findByText(/Ese código no es correcto/)).toBeTruthy()
  })

  it('«Cancelar» goes back to the number as it was', async () => {
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(screen.getByText('+573001234567')).toBeTruthy()
  })
})

describe('Profile — the photo', () => {
  it('shows the initials without a photo, and the photo once there is one', async () => {
    stubApi({ 'GET /me/profile': { body: caro } })
    renderWithQuery(<Profile />)
    expect(await screen.findByText('CM')).toBeTruthy()
    expect(screen.getByText('Agregar foto')).toBeTruthy()
  })

  it('a photo replaces the initials and can be removed', async () => {
    const calls = stubApi({
      'GET /me/profile': { body: { ...caro, photo_url: 'data:image/png;base64,AAAA' } },
      'PATCH /me/profile': { body: caro },
    })
    renderWithQuery(<Profile />)
    expect(await screen.findByRole('img', { name: 'Tu foto de perfil' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Quitar foto' }))
    await waitFor(() =>
      expect(calls.find((c) => c.key === 'PATCH /me/profile')?.body).toEqual({ photo_url: null }),
    )
  })
})
