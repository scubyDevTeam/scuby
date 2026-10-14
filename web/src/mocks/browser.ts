import { setupWorker } from 'msw/browser'
import { handlers } from './handlers'

export async function startMocks(): Promise<void> {
  await setupWorker(...handlers).start({ quiet: true })
}
