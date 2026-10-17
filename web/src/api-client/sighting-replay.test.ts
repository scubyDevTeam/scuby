// The persisted retry queue of docs/eng/frontend.md · Risks §6: «Lo vi» survives no signal, a
// reload and a closed app; a replay is never a second sighting; the server's «no» is final.
import { MutationObserver, onlineManager, QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from './http'
import { isTransient, isWaiting, type SightingSend, sightingMutationKey } from './sighting-queue'
import { type QueueDevice, sightingSend, startSightingQueue } from './sighting-replay'

/** A phone: a storage slot that outlives the app, and a radio the test switches. */
function phone(online = true) {
  let stored: unknown = null
  const listeners = new Set<(online: boolean) => void>()
  const device: QueueDevice = {
    read: () => (stored === null ? null : JSON.parse(JSON.stringify(stored))),
    write: (value) => {
      stored = value
    },
    isOnline: () => online,
    watch: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
  return {
    device,
    stored: () => stored as { v: 1; sends: { send: SightingSend }[] } | null,
    signal(next: boolean) {
      online = next
      for (const listener of listeners) listener(next)
    },
  }
}

type Answer = { status: number; body?: unknown } | 'no-signal'

/** The API: answers in order, the last one repeating. */
function api(...answers: Answer[]) {
  const bodies: Record<string, unknown>[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)))
      const answer = answers.length > 1 ? answers.shift()! : answers[0]!
      if (answer === 'no-signal') throw new TypeError('Failed to fetch')
      return new Response(JSON.stringify(answer.body ?? {}), { status: answer.status })
    }),
  )
  return bodies
}

const created = { status: 201, body: { id: 's-9' } }
const settle = () => vi.advanceTimersByTimeAsync(0)

const send = () =>
  sightingSend('7K3PQ', {
    point: { lat: 6.2455, lng: -75.5905 },
    seenAt: new Date(),
    note: 'Iba hacia el parque',
    contactPhone: null,
  })

const halts: (() => void)[] = []
function app(device: QueueDevice) {
  const client = new QueryClient()
  client.mount()
  halts.push(startSightingQueue(client, device), () => client.unmount())
  const observer = new MutationObserver<{ id: string }, Error, SightingSend>(client, {
    mutationKey: sightingMutationKey('7K3PQ'),
  })
  return {
    client,
    report: (sighting: SightingSend) => observer.mutate(sighting).catch(() => undefined),
    sightings: () => client.getMutationCache().findAll({ mutationKey: ['sighting'] }),
  }
}

/** The tab closes; whatever opens next starts as a fresh page, which assumes it is online. */
function closeApp() {
  for (const halt of halts.splice(0)) halt()
  onlineManager.setOnline(true)
}

beforeEach(() => {
  vi.useFakeTimers()
  onlineManager.setOnline(true)
})
afterEach(() => {
  closeApp()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('sighting queue — frontend.md · Risks §6', () => {
  it('with no signal nothing is sent: the sighting is kept on the device', async () => {
    const bodies = api(created)
    const { device, stored, signal } = phone()
    const { report } = app(device)
    signal(false)
    void report(send())
    await settle()

    expect(bodies).toEqual([])
    expect(stored()?.sends).toHaveLength(1)
    expect(stored()?.sends[0]?.send.body.note).toBe('Iba hacia el parque')
  })

  it('goes by itself when the signal is back, once, and the case is fetched again', async () => {
    const bodies = api(created)
    const { device, stored, signal } = phone()
    const { client, report, sightings } = app(device)
    const refetch = vi.spyOn(client, 'invalidateQueries')
    signal(false)
    const sighting = send()
    void report(sighting)
    await settle()

    signal(true)
    await settle()
    expect(bodies).toHaveLength(1)
    expect(bodies[0]?.client_id).toBe(sighting.body.client_id)
    expect(sightings()[0]?.state.status).toBe('success')
    expect(stored()).toBeNull()
    expect(refetch).toHaveBeenCalledWith({ queryKey: ['case', '7K3PQ'] })
  })

  it('survives a reload: the next app open sends it, with the same replay key', async () => {
    api(created)
    const { device, stored, signal } = phone()
    const first = app(device)
    signal(false)
    const sighting = send()
    void first.report(sighting)
    await settle()
    closeApp()

    // A new page: a new client, the same storage — and a signal.
    const bodies = api(created)
    signal(true)
    app(device)
    await settle()
    expect(bodies).toHaveLength(1)
    expect(bodies[0]?.client_id).toBe(sighting.body.client_id)
    expect(stored()).toBeNull()
  })

  it('opened again still offline, it waits for the signal instead of failing', async () => {
    api(created)
    const { device, signal } = phone()
    const first = app(device)
    signal(false)
    void first.report(send())
    await settle()
    closeApp()

    // A fresh page has heard no `offline` event: only the device says there is no network.
    const bodies = api(created)
    const reopened = app(device)
    await settle()
    expect(bodies).toEqual([])
    expect(reopened.sightings()[0]?.state.isPaused).toBe(true)

    signal(true)
    await settle()
    expect(bodies).toHaveLength(1)
  })

  it('a fetch that dies on one bar is tried again, with the same key, and kept meanwhile', async () => {
    const bodies = api('no-signal', created)
    const { device, stored } = phone(true)
    const { report, sightings } = app(device)
    void report(send())
    await settle()
    expect(bodies).toHaveLength(1)
    expect(stored()?.sends).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(2_000)
    expect(bodies).toHaveLength(2)
    expect(bodies[1]?.client_id).toBe(bodies[0]?.client_id)
    expect(sightings()[0]?.state.status).toBe('success')
    expect(stored()).toBeNull()
  })

  it.each([
    [422, 'sighting_too_far'],
    [429, 'rate_limited'],
  ] as const)('a %i on replay is final: not retried, no longer kept', async (status, code) => {
    api(created)
    const { device, stored, signal } = phone()
    const first = app(device)
    signal(false)
    void first.report(send())
    await settle()
    closeApp()

    const bodies = api({ status, body: { error: { code, message: '' } } })
    signal(true)
    const { sightings } = app(device)
    await settle()
    await vi.advanceTimersByTimeAsync(120_000)
    expect(bodies).toHaveLength(1)
    expect(sightings()[0]?.state.status).toBe('error')
    expect((sightings()[0]?.state.error as ApiError | undefined)?.code).toBe(code)
    expect(stored()).toBeNull()
  })

  it('ignores what it cannot read in storage', async () => {
    const bodies = api(created)
    const { device } = phone()
    device.write({ v: 1, sends: [{ send: { code: '7K3PQ', body: {} } }, null] })
    const { sightings } = app(device)
    await settle()
    expect(sightings()).toEqual([])
    expect(bodies).toEqual([])
  })

  it('each sighting gets its own replay key', () => {
    expect(send().body.client_id).not.toBe(send().body.client_id)
    expect(send().body.client_id?.length).toBeGreaterThanOrEqual(8)
  })

  it('the form says «en espera» when paused, or between retries — not on its first try', () => {
    const state = {
      status: 'pending',
      isPaused: false,
      failureCount: 0,
      failureReason: null,
    } as const
    expect(isWaiting(state)).toBe(false)
    expect(isWaiting({ ...state, isPaused: true })).toBe(true)
    expect(isWaiting({ ...state, failureCount: 1, failureReason: new ApiError('network') })).toBe(
      true,
    )
    const refused = new ApiError('rejected', 429, 'rate_limited')
    expect(isWaiting({ ...state, status: 'error', failureCount: 1, failureReason: refused })).toBe(
      false,
    )
  })

  it('only no answer or a 5xx is worth retrying', () => {
    expect(isTransient(new ApiError('network'))).toBe(true)
    expect(isTransient(new ApiError('server', 503))).toBe(true)
    expect(isTransient(new ApiError('rejected', 429, 'rate_limited'))).toBe(false)
    expect(isTransient(new ApiError('not_found', 404, 'not_found'))).toBe(false)
    expect(isTransient(new ApiError('conflict', 409, 'invalid_transition'))).toBe(false)
  })
})
