// The Sentry SDK, fetched by ./errors.ts after the first paint — never imported anywhere else, or it
// lands in the first load. Errors only: no tracing, no replay. Nothing of the person leaves the
// device: no user data, cookies or bodies (dataCollection), and every string that reaches
// Sentry has its emails and phone numbers masked.
import type { Breadcrumb, ErrorEvent } from '@sentry/react'
import { captureException, captureReactException, init } from '@sentry/react'

export type SdkConfig = { dsn: string; release: string; environment: string }

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}/gi
// 7–15 digits, spaced or dashed, with or without a +prefix: a Colombian mobile or any other.
// A date can be caught too; losing it beats sending a number.
const PHONE = /\+?\d(?:[\s-]?\d){6,14}/g
const MASK = '[redacted]'

export function redact(text: string): string {
  return text.replace(EMAIL, MASK).replace(PHONE, MASK)
}

/** Masks every string inside a value: breadcrumb data, extra context, headers. */
export function redactDeep<T>(value: T, depth = 0): T {
  if (typeof value === 'string') return redact(value) as T
  if (depth > 6 || typeof value !== 'object' || value === null) return value
  if (Array.isArray(value)) return value.map((item) => redactDeep(item, depth + 1)) as T
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, redactDeep(item, depth + 1)]),
  ) as T
}

export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
  return {
    ...breadcrumb,
    message: breadcrumb.message === undefined ? undefined : redact(breadcrumb.message),
    data: breadcrumb.data === undefined ? undefined : redactDeep(breadcrumb.data),
  }
}

export function scrubEvent(event: ErrorEvent): ErrorEvent {
  const { request } = event
  return {
    ...event,
    message: event.message === undefined ? undefined : redact(event.message),
    exception: event.exception && {
      ...event.exception,
      values: event.exception.values?.map((value) => ({
        ...value,
        value: value.value === undefined ? undefined : redact(value.value),
      })),
    },
    breadcrumbs: event.breadcrumbs?.map((crumb) => scrubBreadcrumb(crumb) ?? crumb),
    extra: event.extra && redactDeep(event.extra),
    // The page's URL and the browser, nothing sent or stored by the person.
    request: request && {
      url: request.url && redact(request.url),
      headers: request.headers && redactDeep(request.headers),
    },
    user: undefined,
  }
}

export function start({ dsn, release, environment }: SdkConfig): void {
  init({
    dsn,
    release,
    environment,
    // Who the person is, their cookies, what they sent: none of it is collected.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: { request: { allow: ['User-Agent'] }, response: false },
      httpBodies: [],
      urlQueryParams: false,
      stackFrameVariables: false,
    },
    beforeBreadcrumb: scrubBreadcrumb,
    beforeSend: scrubEvent,
  })
}

/** With the component stack of a boundary, Sentry shows which screen broke. */
export function capture(error: unknown, componentStack?: string): void {
  if (componentStack) captureReactException(error, { componentStack })
  else captureException(error)
}
