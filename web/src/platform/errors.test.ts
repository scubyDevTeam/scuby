// @vitest-environment jsdom
import type { ErrorEvent as SentryEvent } from '@sentry/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { reportError, resetErrorReporting, startErrorReporting } from './errors'

const sentry = vi.hoisted(() => ({
  init: vi.fn(),
  captureException: vi.fn(),
  captureReactException: vi.fn(),
}))
vi.mock('@sentry/react', () => sentry)

const config = {
  dsn: 'https://key@o1.ingest.sentry.io/1',
  release: 'abc123',
  environment: 'preview',
}

afterEach(() => {
  resetErrorReporting()
  vi.clearAllMocks()
})

describe('error reporting — off without a DSN', () => {
  it('never fetches the SDK and reports nothing', async () => {
    const load = vi.fn()
    await startErrorReporting({ ...config, dsn: undefined }, load, 0)
    reportError(new Error('boom'))
    expect(load).not.toHaveBeenCalled()
    expect(sentry.init).not.toHaveBeenCalled()
  })
})

describe('error reporting — with a DSN', () => {
  it('starts Sentry after the page has loaded, with the release and no personal data', async () => {
    const load = vi.fn(() => import('./errors-sdk'))
    await startErrorReporting(config, load, 0)
    expect(load).toHaveBeenCalledOnce()
    expect(sentry.init).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: config.dsn,
        release: 'abc123',
        environment: 'preview',
        dataCollection: expect.objectContaining({
          userInfo: false,
          cookies: false,
          httpBodies: [],
          urlQueryParams: false,
        }),
        beforeSend: expect.any(Function),
        beforeBreadcrumb: expect.any(Function),
      }),
    )
    // No tracing, no replay: errors only.
    expect(sentry.init.mock.calls[0]?.[0]).not.toHaveProperty('tracesSampleRate')
  })

  it('keeps what broke before the SDK arrived and sends it once it has', async () => {
    let arrive: () => void = () => undefined
    const arrived = new Promise<void>((resolve) => {
      arrive = resolve
    })
    const started = startErrorReporting(
      config,
      async () => {
        await arrived
        return import('./errors-sdk')
      },
      0,
    )
    const early = new Error('early')
    reportError(early, 'at CasePage')
    reportError(early, 'at CasePage')
    expect(sentry.captureReactException).not.toHaveBeenCalled()
    arrive()
    await started
    expect(sentry.captureReactException).toHaveBeenCalledOnce()
    expect(sentry.captureReactException).toHaveBeenCalledWith(early, {
      componentStack: 'at CasePage',
    })
    reportError(new Error('later'))
    expect(sentry.captureException).toHaveBeenCalledOnce()
  })

  it('stays off when the SDK cannot be fetched', async () => {
    await startErrorReporting(config, () => Promise.reject(new Error('offline')), 0)
    reportError(new Error('boom'))
    expect(sentry.captureException).not.toHaveBeenCalled()
  })

  it('masks emails and phone numbers and drops what the person sent', async () => {
    await startErrorReporting(config, () => import('./errors-sdk'), 0)
    const [options] = sentry.init.mock.calls[0] ?? []
    const { beforeSend, beforeBreadcrumb } = options
    const event = {
      message: 'claim from ana@example.com',
      exception: { values: [{ type: 'Error', value: 'bad phone +57 311 482 9017' }] },
      breadcrumbs: [{ category: 'console', message: 'sent to 3114829017' }],
      request: {
        url: 'https://app.test/c/7K3PQ?email=ana@example.com',
        data: '{"phone":"+573114829017"}',
        cookies: { session: 's' },
        headers: { 'User-Agent': 'Android' },
      },
      user: { email: 'ana@example.com' },
    } as unknown as SentryEvent
    const sent = beforeSend(event, {})
    const text = JSON.stringify(sent)
    expect(text).not.toMatch(/ana@example\.com|3114829017|311 482 9017/)
    expect(sent.request).toEqual({
      url: 'https://app.test/c/7K3PQ?email=[redacted]',
      headers: { 'User-Agent': 'Android' },
    })
    expect(sent.user).toBeUndefined()
    expect(sent.exception.values[0].value).toBe('bad phone [redacted]')
    // A case code is not a phone number.
    expect(text).toContain('/c/7K3PQ')

    const crumb = beforeBreadcrumb({
      category: 'fetch',
      data: { url: '/auth/otp?phone=+573114829017', status_code: 200 },
    })
    expect(crumb.data).toEqual({ url: '/auth/otp?phone=[redacted]', status_code: 200 })
  })
})
