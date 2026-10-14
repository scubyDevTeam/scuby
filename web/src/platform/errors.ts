// Error reporting (docs/eng/frontend.md · Budgets: Sentry from the first deploy). The app calls
// `reportError()`; this file is all of it that ships in the first load. The SDK
// (./errors-sdk.ts, @sentry/react) is fetched after the page has painted, because `/c/:code` has
// no room for it in its 150 KB: until then the errors wait in a short queue here. With no DSN
// (`mock-…` in .env) nothing is queued and the SDK is never fetched.
import { env } from '../env'

export type ErrorReportingConfig = {
  dsn: string | undefined
  /** The build id: the same name the sourcemaps were uploaded under (vite.config.ts). */
  release: string
  environment: string
}

type Sdk = typeof import('./errors-sdk')
type Pending = { error: unknown; componentStack?: string }

// Enough for a crash and what led to it; a loop of errors does not grow without end.
const QUEUE_LIMIT = 20

let sdk: Sdk | undefined
/** `undefined`: reporting is off (no DSN, or the SDK could not load). */
let queue: Pending[] | undefined
// StrictMode, and a boundary that sees what a window handler saw: one error, one report.
let reported = new WeakSet<object>()

const fromEnv = (): ErrorReportingConfig => ({
  dsn: env.sentryDsn,
  release: env.buildId,
  environment: env.deployEnv,
})

// After `load` the case page is still fetching its case and painting the photo; on Slow 4G the
// SDK's 31 KB, fetched at once, measurably delayed that paint (Lighthouse, +0.3 s LCP).
const SETTLE_MS = 3_000

/** Once the page has loaded, settled, and the main thread is free. */
function afterFirstPaint(settleMs: number): Promise<void> {
  return new Promise((resolve) => {
    const idle = () =>
      typeof requestIdleCallback === 'function'
        ? requestIdleCallback(() => resolve(), { timeout: 5_000 })
        : setTimeout(resolve, 1)
    const settle = () => setTimeout(idle, settleMs)
    if (document.readyState === 'complete') settle()
    else window.addEventListener('load', settle, { once: true })
  })
}

const onError = (event: ErrorEvent) => reportError(event.error ?? event.message)
const onRejection = (event: PromiseRejectionEvent) => reportError(event.reason)

function stopListening() {
  window.removeEventListener('error', onError)
  window.removeEventListener('unhandledrejection', onRejection)
}

/**
 * Called once, by main.tsx, before the first render. Errors thrown until the SDK is up are kept and
 * sent when it is (lost if the person leaves first: the price of the budget); from then on the
 * SDK's own handlers catch what nobody caught.
 */
export async function startErrorReporting(
  config: ErrorReportingConfig = fromEnv(),
  load: () => Promise<Sdk> = () => import('./errors-sdk'),
  settleMs = SETTLE_MS,
): Promise<void> {
  const { dsn } = config
  if (!dsn || queue || sdk) return
  queue = []
  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)
  try {
    await afterFirstPaint(settleMs)
    const loaded = await load()
    stopListening()
    loaded.start({ ...config, dsn })
    sdk = loaded
    for (const pending of queue) loaded.capture(pending.error, pending.componentStack)
  } catch {
    // Offline, or the chunk is gone after a deploy: nothing to report to on this visit.
    stopListening()
  } finally {
    queue = undefined
  }
}

/** An error the app caught (the root boundary) or saw thrown. A no-op when reporting is off. */
export function reportError(error: unknown, componentStack?: string): void {
  if (typeof error === 'object' && error !== null) {
    if (reported.has(error)) return
    reported.add(error)
  }
  if (sdk) sdk.capture(error, componentStack)
  else if (queue && queue.length < QUEUE_LIMIT) queue.push({ error, componentStack })
}

/** Tests only: back to «never started». */
export function resetErrorReporting(): void {
  stopListening()
  sdk = undefined
  queue = undefined
  reported = new WeakSet()
}
