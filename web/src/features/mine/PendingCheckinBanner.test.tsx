// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderWithQuery, stubApi } from '../../test-utils'
import { PendingCheckinBanner } from './PendingCheckinBanner'

const mine = (code: string, title: string, vertical: string, pendingSince: number | null) => ({
  code,
  vertical,
  status: 'active',
  title,
  place_name: 'Laureles',
  photo_url: null,
  published_at: new Date(Date.now() - 9 * 86_400_000).toISOString(),
  open_claim_count: 0,
  pending_checkin_at:
    pendingSince === null ? null : new Date(Date.now() - pendingSince).toISOString(),
})

function show(answer: { status?: number; body?: unknown }) {
  stubApi({ 'GET /me/cases': answer })
  return renderWithQuery(
    <PendingCheckinBanner caseLink={(code, children) => <a href={`/c/${code}`}>{children}</a>} />,
  )
}

describe('PendingCheckinBanner (comms.md · In-app: a banner on home until answered)', () => {
  it('names the case with the oldest question and links to it', async () => {
    show({
      body: [
        mine('M1SHI', 'Misha', 'adoption', 3_600_000),
        mine('M2TQ4', 'Milo', 'lost', 86_400_000),
        mine('7K3PQ', 'Luna', 'lost', null),
      ],
    })
    expect(await screen.findByText('El aviso de Milo espera tu respuesta.')).toBeTruthy()
    expect(screen.getByText('Y 1 más en «Mis casos».')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Responder' }).getAttribute('href')).toBe('/c/M2TQ4')
  })

  it('speaks each vertical’s words', async () => {
    show({ body: [mine('NA7LA', 'Nala', 'help', 3_600_000)] })
    expect(await screen.findByText('La solicitud de Nala espera tu respuesta.')).toBeTruthy()
    expect(screen.getByText('Si no respondes, se archiva.')).toBeTruthy()
  })

  it.each([
    ['nothing waits', { body: [mine('7K3PQ', 'Luna', 'lost', null)] }],
    ['the list fails', { status: 500 }],
  ])('is not there when %s', async (_, answer) => {
    const calls = stubApi({ 'GET /me/cases': answer })
    const { container } = renderWithQuery(
      <PendingCheckinBanner caseLink={(code, children) => <a href={`/c/${code}`}>{children}</a>} />,
    )
    await waitFor(() => expect(calls.some((c) => c.key === 'GET /me/cases')).toBe(true))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(container.textContent).toBe('')
  })
})
