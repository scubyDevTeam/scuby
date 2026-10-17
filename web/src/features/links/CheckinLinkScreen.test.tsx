// @vitest-environment jsdom
import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderWithQuery, stubApi } from '../../test-utils'
import { CheckinLinkScreen } from './CheckinLinkScreen'

const link = (fields: Record<string, unknown>) => ({
  case_code: 'M2TQ4',
  vertical: 'lost',
  pet_name: 'Milo',
  photo_url: null,
  response: 'still_lost',
  kind: 'safe',
  state: 'applied',
  decline_token: null,
  ...fields,
})

type Answer = { status?: number; body?: unknown } | (() => { status?: number; body?: unknown })

function show(open: Answer, confirm?: Answer) {
  const calls = stubApi({
    'GET /checkin-links/tok': open,
    ...(confirm ? { 'POST /checkin-links/tok': confirm } : {}),
  })
  renderWithQuery(
    <CheckinLinkScreen
      token="tok"
      caseLink={(code, children) => <a href={`/c/${code}`}>{children}</a>}
      otherLink={(token, children) => <a href={`/r/${token}`}>{children}</a>}
      homeLink={(children) => <a href="/">{children}</a>}
    />,
  )
  return calls
}

describe('CheckinLinkScreen (comms.md · The scanner rule)', () => {
  it('a safe answer was applied by opening the link: it thanks and links to the case', async () => {
    const calls = show({ body: link({}) })
    expect(await screen.findByRole('heading', { name: 'Gracias, seguimos buscando' })).toBeTruthy()
    expect(screen.getByText(/Dejamos el aviso de Milo activo/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Ver el aviso' }).getAttribute('href')).toBe('/c/M2TQ4')
    expect(calls.some((c) => c.key.startsWith('POST'))).toBe(false)
  })

  it('thanks in each vertical’s words', async () => {
    show({ body: link({ vertical: 'adoption', pet_name: 'Misha', response: 'still_available' }) })
    expect(await screen.findByRole('heading', { name: 'Gracias, sigue publicada' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Ver la publicación' })).toBeTruthy()
  })

  it('a consequential answer asks first; only the button acts', async () => {
    const calls = show(
      {
        body: link({
          response: 'reunited',
          kind: 'consequential',
          state: 'confirm',
          decline_token: 'safe-tok',
        }),
      },
      { body: link({ response: 'reunited', kind: 'consequential', state: 'applied' }) },
    )
    expect(
      await screen.findByRole('heading', { name: '¿Confirmas que Milo ya apareció?' }),
    ).toBeTruthy()
    expect(screen.getByRole('link', { name: 'No, sigue perdida' }).getAttribute('href')).toBe(
      '/r/safe-tok',
    )
    expect(calls.some((c) => c.key === 'POST /checkin-links/tok')).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Sí, ya apareció' }))
    expect(await screen.findByRole('heading', { name: '¡Milo ya está en casa!' })).toBeTruthy()
    expect(calls.filter((c) => c.key === 'POST /checkin-links/tok')).toHaveLength(1)
  })

  it('a failed confirm says so and keeps the button', async () => {
    show(
      { body: link({ response: 'delete', kind: 'consequential', state: 'confirm' }) },
      { status: 500 },
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Sí, eliminar el aviso' }))
    expect(await screen.findByText('No pudimos guardar tu respuesta.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Sí, eliminar el aviso' })).toBeTruthy()
  })

  it.each([
    ['used', 'Ya tenemos tu respuesta'],
    ['already_answered', 'Esta pregunta ya tiene respuesta'],
    ['expired', 'Este enlace venció'],
  ])('a link that is %s acts no more and points to the case', async (state, title) => {
    show({ body: link({ response: 'reunited', kind: 'consequential', state }) })
    expect(await screen.findByRole('heading', { name: title })).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByRole('link', { name: 'Ver el aviso' })).toBeTruthy()
  })

  it('an unknown token', async () => {
    show({ status: 404, body: { error: { code: 'not_found', message: 'not_found' } } })
    expect(await screen.findByRole('heading', { name: 'Este enlace no existe' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Ver avisos cerca de mí' })).toBeTruthy()
  })

  it('a network failure offers to retry', async () => {
    show(() => {
      throw new TypeError('offline')
    })
    expect(await screen.findByRole('heading', { name: 'No pudimos abrir el enlace' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeTruthy()
  })

  it('has a loading state', () => {
    show({ body: link({}) })
    expect(screen.getByRole('status', { name: 'Abriendo el enlace' })).toBeTruthy()
  })
})
