import { setupWorker } from 'msw/browser'
import { persist } from './db'
import { handlers } from './handlers'

export async function startMocks(): Promise<void> {
  const worker = setupWorker(...handlers)
  worker.events.on('request:end', persist)
  await worker.start({ quiet: true })
}
