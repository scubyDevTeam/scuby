// The sighting queue wired to this device: storage and the network's word from src/platform
// (docs/eng/frontend.md · Risks §6). Started by the form, and by main.tsx when a send is waiting.
import { SIGHTING_QUEUE_STORAGE } from '@api-client/sighting-pending'
import { type QueueDevice, startSightingQueue } from '@api-client/sighting-replay'
import { isOnline, watchConnectivity } from '@platform/network'
import { readStored, writeStored } from '@platform/storage'
import { type QueryClient, useQueryClient } from '@tanstack/react-query'
import { useSyncExternalStore } from 'react'

const device: QueueDevice = {
  read: () => readStored(SIGHTING_QUEUE_STORAGE),
  write: (value) => writeStored(SIGHTING_QUEUE_STORAGE, value),
  isOnline,
  watch: watchConnectivity,
}

export const startQueue = (client: QueryClient) => startSightingQueue(client, device)

/** In render, not in an effect: the form's mutation must find its defaults when it is built. */
export function useSightingQueue(): void {
  startQueue(useQueryClient())
}

const subscribe = (changed: () => void) => watchConnectivity(() => changed())

/** The device's word on the network, for the «Sin conexión» band. */
export const useOnline = (): boolean => useSyncExternalStore(subscribe, isOnline, () => true)
