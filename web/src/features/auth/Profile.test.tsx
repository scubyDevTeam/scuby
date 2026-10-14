// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderWithQuery, stubApi } from '../../test-utils'
import { Profile } from './Profile'

describe('Profile', () => {
  it('shows who is signed in and with which email', () => {
    stubApi()
    renderWithQuery(
      <Profile user={{ id: 'u1', displayName: 'Carolina Mejía', email: 'caro@correo.co' }} />,
    )
    expect(screen.getByRole('heading', { name: 'Carolina Mejía' })).toBeTruthy()
    expect(screen.getByText('CM')).toBeTruthy()
    expect(screen.getByText('caro@correo.co')).toBeTruthy()
  })

  it('signs out', async () => {
    const calls = stubApi({ 'POST /auth/sign-out': { status: 204 } })
    renderWithQuery(
      <Profile user={{ id: 'u1', displayName: 'Carolina Mejía', email: 'caro@correo.co' }} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }))
    await waitFor(() => expect(calls.at(-1)?.key).toBe('POST /auth/sign-out'))
  })
})
