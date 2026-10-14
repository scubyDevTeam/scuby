import { env } from '../env'

export type ApiErrorKind =
  | 'network'
  | 'unauthorized'
  | 'not_found'
  | 'gone'
  | 'rejected' // the server refused what was sent: validation, rate limit
  | 'server'
  | 'unexpected_response'

/** Every failure a screen has to render, as a closed set. */
export class ApiError extends Error {
  readonly kind: ApiErrorKind
  readonly status: number | null

  constructor(kind: ApiErrorKind, status: number | null = null) {
    super(`API error: ${kind}${status ? ` (${status})` : ''}`)
    this.name = 'ApiError'
    this.kind = kind
    this.status = status
  }
}

function kindFor(status: number): ApiErrorKind {
  if (status === 401) return 'unauthorized'
  if (status === 404) return 'not_found'
  if (status === 410) return 'gone'
  if (status === 422 || status === 429) return 'rejected'
  return 'server'
}

async function send<T>(url: URL, init: RequestInit, parse: (raw: unknown) => T): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, { ...init, credentials: 'include' })
  } catch {
    throw new ApiError('network')
  }
  if (!response.ok) throw new ApiError(kindFor(response.status), response.status)

  try {
    return parse(response.status === 204 ? null : await response.json())
  } catch {
    throw new ApiError('unexpected_response', response.status)
  }
}

export function apiGet<T>(
  path: string,
  parse: (raw: unknown) => T,
  params?: Record<string, string | undefined>,
): Promise<T> {
  const url = new URL(path, env.apiUrl)
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined) url.searchParams.set(key, value)
  }
  return send(url, { headers: { Accept: 'application/json' } }, parse)
}

export function apiPost<T>(path: string, body: unknown, parse: (raw: unknown) => T): Promise<T> {
  return send(
    new URL(path, env.apiUrl),
    {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    parse,
  )
}
