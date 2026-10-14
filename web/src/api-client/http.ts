import {
  type BodyOf,
  buildPath,
  type Endpoint,
  type ParamsOf,
  type QueryOf,
} from '../contracts/endpoint'
import { type ErrorCode, parseFailure } from '../contracts/errors'
import { env } from '../env'

export type ApiErrorKind =
  | 'network'
  | 'unauthorized'
  | 'forbidden' // signed in, but it is someone else's
  | 'not_found'
  | 'gone'
  | 'conflict' // it clashes with something that already exists
  | 'rejected' // the server refused what was sent: validation, rate limit
  | 'server'
  | 'unexpected_response'

/** Every failure a screen has to render, as a closed set. */
export class ApiError extends Error {
  readonly kind: ApiErrorKind
  readonly status: number | null
  /** The contract's own reason, when the answer carried the error envelope. */
  readonly code: ErrorCode | null
  readonly details: Record<string, string>
  /** `validation_failed` only: wire field path → what is wrong with it (for logs, never shown). */
  readonly fields: Record<string, string>

  constructor(
    kind: ApiErrorKind,
    status: number | null = null,
    code: ErrorCode | null = null,
    details: Record<string, string> = {},
    fields: Record<string, string> = {},
  ) {
    super(`API error: ${code ?? kind}${status ? ` (${status})` : ''}`)
    this.name = 'ApiError'
    this.kind = kind
    this.status = status
    this.code = code
    this.details = details
    this.fields = fields
  }
}

function kindFor(status: number): ApiErrorKind {
  if (status === 401) return 'unauthorized'
  if (status === 403) return 'forbidden'
  if (status === 404) return 'not_found'
  if (status === 409) return 'conflict'
  if (status === 410) return 'gone'
  if (status === 422 || status === 429) return 'rejected'
  return 'server'
}

async function failure(response: Response): Promise<ApiError> {
  // The envelope is optional on the way in: a proxy's 502 has none, and the status still says enough.
  const body = parseFailure(await response.json().catch(() => null))
  return new ApiError(
    kindFor(response.status),
    response.status,
    body?.code,
    body?.details,
    body?.fields,
  )
}

type Options<E extends Endpoint> = (keyof ParamsOf<E> extends never
  ? { params?: undefined }
  : { params: ParamsOf<E> }) &
  (BodyOf<E> extends undefined ? { body?: undefined } : { body: BodyOf<E> }) & {
    query?: QueryOf<E>
  }

let language: string | null = null

/**
 * The language the screen is in. Sent as `Accept-Language` on every request, so the text the
 * server composes for display (a place name, a summary, a notification) comes in it too.
 */
export function setRequestLanguage(locale: string): void {
  language = locale
}

function init(endpoint: Endpoint, body: unknown): RequestInit {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (language) headers['Accept-Language'] = language
  if (endpoint.body === 'multipart') {
    // The browser sets the boundary, so no Content-Type here.
    const form = new FormData()
    form.append('file', body as Blob, 'photo.jpg')
    return { method: endpoint.method, headers, body: form }
  }
  if (endpoint.body === null) return { method: endpoint.method, headers }
  headers['Content-Type'] = 'application/json'
  return { method: endpoint.method, headers, body: JSON.stringify(body) }
}

/**
 * One request, described by its contract entry. `parse` turns the wire answer into the type the
 * app uses; an answer it rejects is `unexpected_response`, never a half-read object.
 */
export async function call<E extends Endpoint, T>(
  endpoint: E,
  options: Options<E>,
  parse: (raw: unknown) => T,
): Promise<T> {
  const url = new URL(buildPath(endpoint.path, options.params), env.apiUrl)
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value))
  }

  let response: Response
  try {
    response = await fetch(url, { ...init(endpoint, options.body), credentials: 'include' })
  } catch {
    throw new ApiError('network')
  }
  if (!response.ok) throw await failure(response)

  try {
    return parse(response.status === 204 ? null : await response.json())
  } catch {
    throw new ApiError('unexpected_response', response.status)
  }
}
