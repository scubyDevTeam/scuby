// @vitest-environment jsdom
import { useSession } from '@api-client/session'
import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderWithQuery, stubApi } from '../../test-utils'
import { SignIn } from './SignIn'

const user = { id: 'u1', display_name: 'Juan Pérez', email: 'juan@correo.co' }

/** Renders the form next to who the session says is signed in — the thing signing in must change. */
function Harness(props: { googleClientId?: string; demoCode?: string }) {
  const session = useSession()
  return (
    <>
      <p data-testid="who">{session.data?.displayName ?? 'nobody'}</p>
      <SignIn googleClientId={props.googleClientId} demoCode={props.demoCode} legal="Términos" />
    </>
  )
}

function show(
  routes: Parameters<typeof stubApi>[0] = {},
  props: Parameters<typeof Harness>[0] = {},
) {
  const calls = stubApi({
    'GET /session': { status: 401 },
    'POST /auth/email/start': { status: 204 },
    'POST /auth/email/verify': { body: user },
    ...routes,
  })
  renderWithQuery(<Harness {...props} />)
  return calls
}

const typeEmail = (value: string) =>
  fireEvent.change(screen.getByLabelText('Correo electrónico'), { target: { value } })
const askForCode = () => fireEvent.click(screen.getByRole('button', { name: 'Enviarme un código' }))
const typeCode = async (value: string) =>
  fireEvent.change(await screen.findByLabelText(/Código de 6 dígitos/), { target: { value } })

describe('SignIn — auth.md · two doors, no passwords', () => {
  it('signs in with the emailed code, sent on the sixth digit', async () => {
    const calls = show()
    typeEmail(' juan@correo.co ')
    askForCode()
    await typeCode('481937')

    expect(await screen.findByText('Juan Pérez')).toBeTruthy()
    expect(calls.map((c) => c.key)).toContain('POST /auth/email/start')
    expect(calls.at(-1)).toEqual({
      key: 'POST /auth/email/verify',
      body: { email: 'juan@correo.co', code: '481937' },
    })
  })

  it('does not ask for a code with an incomplete email', () => {
    const calls = show()
    typeEmail('juan@')
    askForCode()

    expect(screen.getByRole('alert').textContent).toBe('Revisa tu correo: parece incompleto')
    expect(calls.some((c) => c.key === 'POST /auth/email/start')).toBe(false)
  })

  it('waits for all six digits before checking', async () => {
    const calls = show()
    typeEmail('juan@correo.co')
    askForCode()
    await typeCode('4819')

    expect(calls.some((c) => c.key === 'POST /auth/email/verify')).toBe(false)
    expect(screen.getByTestId('who').textContent).toBe('nobody')
  })

  it('says so when the code is wrong and stays signed out', async () => {
    show({ 'POST /auth/email/verify': { status: 422 } })
    typeEmail('juan@correo.co')
    askForCode()
    await typeCode('000000')

    expect((await screen.findByRole('alert')).textContent).toMatch(/Ese código no coincide/)
    expect(screen.getByTestId('who').textContent).toBe('nobody')
  })

  it('makes the resend wait out its cooldown', async () => {
    show()
    typeEmail('juan@correo.co')
    askForCode()

    const resend = await screen.findByRole('button', { name: /Reenviar código en 60 s/ })
    expect((resend as HTMLButtonElement).disabled).toBe(true)
  })

  it('has no password field anywhere', async () => {
    show()
    typeEmail('juan@correo.co')
    askForCode()
    await screen.findByLabelText(/Código de 6 dígitos/)
    expect(document.querySelector('input[type="password"]')).toBeNull()
  })
})

describe('SignIn — Google', () => {
  it('is not offered without a client id outside a demo', () => {
    show()
    expect(screen.queryByRole('button', { name: 'Continuar con Google' })).toBeNull()
  })

  it('signs in on the emulated backend, which also shows its demo code', async () => {
    show({ 'POST /auth/google': { body: user } }, { demoCode: '123456' })
    fireEvent.click(screen.getByRole('button', { name: 'Continuar con Google' }))
    expect(await screen.findByText('Juan Pérez')).toBeTruthy()
  })
})
