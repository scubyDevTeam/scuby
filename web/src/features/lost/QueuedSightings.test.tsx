// @vitest-environment jsdom
import { type QueueDevice, sightingSend, startSightingQueue } from '@api-client/sighting-replay'
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { stubApi } from '../../test-utils'
import { QueuedSightings } from './QueuedSightings'

const halts: (() => void)[] = []
afterEach(() => {
  for (const halt of halts.splice(0)) halt()
  onlineManager.setOnline(true)
})

/** A device that kept one «Lo vi» on 7K3PQ from an earlier visit, and has no signal yet. */
function reopen() {
  let online = false
  const listeners = new Set<(online: boolean) => void>()
  const send = sightingSend('7K3PQ', {
    point: { lat: 6.2455, lng: -75.5905 },
    seenAt: new Date(Date.now() - 60_000),
    note: 'Iba hacia el parque',
    contactPhone: null,
  })
  const device: QueueDevice = {
    read: () => ({ v: 1, sends: [{ send, submittedAt: Date.now() - 60_000 }] }),
    write: () => undefined,
    isOnline: () => online,
    watch: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
  const client = new QueryClient()
  halts.push(startSightingQueue(client, device))
  render(
    <QueryClientProvider client={client}>
      <QueuedSightings code="7K3PQ" petName="Luna" now={new Date()} />
    </QueryClientProvider>,
  )
  return () => {
    online = true
    for (const listener of listeners) listener(true)
  }
}

describe('QueuedSightings — the reporter’s own unsent «Lo vi», on this device only', () => {
  it('shows it «En espera» until it is sent, then it is an ordinary pin', async () => {
    const calls = stubApi({ 'POST /cases/7K3PQ/sightings': { status: 201, body: { id: 's9' } } })
    const backOnline = reopen()
    expect(screen.getByText('Viste a Luna · hace 1 min')).toBeTruthy()
    expect(screen.getByText('«Iba hacia el parque»')).toBeTruthy()
    expect(screen.getByText('En espera')).toBeTruthy()

    backOnline()
    await waitFor(() => expect(screen.queryByText('En espera')).toBeNull())
    expect(calls.filter((c) => c.key.startsWith('POST'))).toHaveLength(1)
  })

  it('a refusal on replay is said, with its reason, until the reporter dismisses it', async () => {
    stubApi({
      'POST /cases/7K3PQ/sightings': {
        status: 429,
        body: { error: { code: 'rate_limited', message: '' } },
      },
    })
    const backOnline = reopen()
    backOnline()

    expect(await screen.findByText('No se envió')).toBeTruthy()
    expect(screen.getByText('Ya registraste un avistamiento hace poco.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Descartar' }))
    await waitFor(() => expect(screen.queryByText('No se envió')).toBeNull())
    vi.unstubAllGlobals()
  })
})
