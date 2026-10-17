// The one mutation with a persisted retry queue (docs/eng/frontend.md · Risks §6): «Lo vi» is sent
// outdoors, one-handed, on a weak signal, by someone with no account and no reason to try again.
// TanStack Query does the waiting — mutation defaults give a restored send its function back, a
// paused mutation resumes when the browser says it is online — and this module persists what is
// still pending, so a reload or a closed app does not lose it. Every send carries a `client_id`:
// a replay whose first answer was lost on the way is the same sighting, never a second one.
// Loaded lazily (the form's chunk, or main.tsx when something is waiting): not the first load.
import {
  hydrate,
  type Mutation,
  onlineManager,
  type QueryClient,
  useMutation,
} from '@tanstack/react-query'
import { parseCreated, type SightingInput, sightingBody } from '../contracts/actions'
import { reportSighting } from '../contracts/endpoints/helpers'
import { call } from './http'
import {
  isTransient,
  isWaiting,
  markWaited,
  SIGHTING_MUTATION,
  type SightingSend,
  sightingMutationKey,
} from './sighting-queue'

/** The device behind the queue (src/platform): where it keeps the sends, and the network's word. */
export type QueueDevice = {
  read: () => unknown
  write: (value: unknown) => void
  isOnline: () => boolean
  watch: (listener: (online: boolean) => void) => () => void
}

/** What is kept on the device: the sends, not TanStack's internals, so a library update can't strand one. */
type Stored = { v: 1; sends: { send: SightingSend; submittedAt: number }[] }

/** Backoff between attempts while the network answers nothing: 2 s, 4 s … capped at 30 s. */
export const retryDelay = (failures: number) => Math.min(1000 * 2 ** failures, 30_000)

const isSighting = (mutation: Mutation) => mutation.options.mutationKey?.[0] === SIGHTING_MUTATION

function isSend(value: unknown): value is SightingSend {
  const send = value as SightingSend | null
  return (
    typeof send?.code === 'string' &&
    typeof send.body?.seen_at === 'string' &&
    typeof send.body.client_id === 'string'
  )
}

function readStored(device: QueueDevice): Stored['sends'] {
  const stored = device.read() as Stored | null
  if (stored?.v !== 1 || !Array.isArray(stored.sends)) return []
  return stored.sends.filter((entry) => isSend(entry?.send))
}

function snapshot(client: QueryClient): Stored | null {
  const sends = client
    .getMutationCache()
    .getAll()
    .filter((mutation) => isSighting(mutation) && mutation.state.status === 'pending')
    .map((mutation) => ({
      send: mutation.state.variables as SightingSend,
      submittedAt: mutation.state.submittedAt,
    }))
  return sends.length > 0 ? { v: 1, sends } : null
}

const running = new WeakMap<QueryClient, () => void>()

/**
 * Gives the client its sighting defaults, restores what this device still had waiting and replays
 * it when there is a network. Idempotent per client; answers the function that stops it (tests).
 */
export function startSightingQueue(client: QueryClient, device: QueueDevice): () => void {
  const already = running.get(client)
  if (already) return already

  // The browser's online/offline events, through the platform gateway. TanStack's own default:
  // assume online until told otherwise, since `onLine === false` is not always true.
  onlineManager.setEventListener((setOnline) => device.watch(setOnline))

  client.setMutationDefaults([SIGHTING_MUTATION], {
    mutationFn: (send: SightingSend) =>
      call(reportSighting, { params: { code: send.code }, body: send.body }, parseCreated),
    retry: (_failures, error) => isTransient(error),
    retryDelay,
    // The case's map and timeline change: the sighting is a pin on it now.
    onSuccess: (_created, send: SightingSend) =>
      client.invalidateQueries({ queryKey: ['case', send.code] }),
  })

  const cache = client.getMutationCache()
  const stop = cache.subscribe(({ mutation }) => {
    if (!mutation || !isSighting(mutation)) return
    if (isWaiting(mutation.state)) markWaited(mutation)
    device.write(snapshot(client))
  })

  const restored = readStored(device)
  if (restored.length > 0) {
    hydrate(client, {
      mutations: restored.map(({ send, submittedAt }) => ({
        mutationKey: [...sightingMutationKey(send.code)],
        state: {
          context: undefined,
          data: undefined,
          error: null,
          failureCount: 0,
          failureReason: null,
          // Paused: it goes the moment there is a network — now, or on the next `online`.
          isPaused: true,
          status: 'pending',
          variables: send,
          submittedAt,
        },
      })),
    })
    for (const mutation of cache.getAll()) if (isSighting(mutation)) markWaited(mutation)
  }

  // TanStack resumes paused sends on its own `online`; this also covers a device that opened the
  // app offline, when the client never heard an `offline` and so hears no change either.
  const resume = () => void client.resumePausedMutations()
  const unwatch = device.watch((online) => online && resume())
  if (device.isOnline()) resume()

  const halt = () => {
    stop()
    unwatch()
    running.delete(client)
  }
  running.set(client, halt)
  return halt
}

function newClientId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  // Older browsers outside a secure context: 16 random bytes are as good a key.
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
}

/** One «Lo vi», made once: its replay key is fixed here and sent on every attempt. */
export const sightingSend = (code: string, input: SightingInput): SightingSend => ({
  code,
  body: sightingBody({ ...input, clientId: input.clientId ?? newClientId() }),
})

/** The send itself; its function, retries and invalidation are the defaults above. */
export function useReportSighting(code: string) {
  return useMutation<{ id: string }, Error, SightingSend>({
    mutationKey: sightingMutationKey(code),
  })
}
