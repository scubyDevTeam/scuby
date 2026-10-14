import { env } from '../env'

export type ApiErrorKind = 'network' | 'not_found' | 'gone' | 'server' | 'unexpected_response'

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
  if (status === 404) return 'not_found'
  if (status === 410) return 'gone'
  return 'server'
}

export async function apiGet<T>(
  path: string,
  parse: (raw: unknown) => T,
  params?: Record<string, string | undefined>,
): Promise<T> {
  const url = new URL(path, env.apiUrl)
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined) url.searchParams.set(key, value)
  }

  let response: Response
  try {
    response = await fetch(url, { headers: { Accept: 'application/json' }, credentials: 'include' })
  } catch {
    throw new ApiError('network')
  }
  if (!response.ok) throw new ApiError(kindFor(response.status), response.status)

  try {
    return parse(await response.json())
  } catch {
    throw new ApiError('unexpected_response', response.status)
  }
}
