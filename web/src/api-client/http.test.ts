import { describe, expect, it, vi } from 'vitest'
import { ApiError, apiGet, apiPost } from './http'

const respond = (status: number, body: unknown = {}) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  )

const kindOf = async (promise: Promise<unknown>) => {
  try {
    await promise
  } catch (error) {
    if (error instanceof ApiError) return error.kind
  }
  return null
}

describe('apiGet', () => {
  it('returns the parsed body and sends the defined params only', async () => {
    respond(200, { ok: true })
    const result = await apiGet('/feed', (raw) => raw, { vertical: 'lost', species: undefined })

    expect(result).toEqual({ ok: true })
    const url = vi.mocked(fetch).mock.calls[0]?.[0] as URL
    expect(url.pathname).toBe('/feed')
    expect(url.search).toBe('?vertical=lost')
  })

  it.each([
    [401, 'unauthorized'],
    [404, 'not_found'],
    [422, 'rejected'],
    [429, 'rejected'],
    [410, 'gone'],
    [500, 'server'],
  ])('maps HTTP %i to «%s»', async (status, kind) => {
    respond(status)
    expect(await kindOf(apiGet('/cases/X', (raw) => raw))).toBe(kind)
  })

  it('maps a failed request to «network»', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')))
    expect(await kindOf(apiGet('/feed', (raw) => raw))).toBe('network')
  })

  it('maps a body the contract rejects to «unexpected_response»', async () => {
    respond(200, { nope: true })
    const parse = () => {
      throw new Error('bad shape')
    }
    expect(await kindOf(apiGet('/feed', parse))).toBe('unexpected_response')
  })

  it('posts a JSON body', async () => {
    respond(201, { id: 'x' })
    await apiPost('/reports', { reason: 'spam' }, (raw) => raw)
    const init = vi.mocked(fetch).mock.calls[0]?.[1]
    expect(init?.method).toBe('POST')
    expect(init?.body).toBe('{"reason":"spam"}')
  })

  it('accepts an answer with no body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 204 })),
    )
    expect(await apiPost('/auth/sign-out', {}, () => null)).toBeNull()
  })
})
