import { describe, expect, it, vi } from 'vitest'
import { api } from '../contracts/api'
import { ApiError, call, setRequestLanguage } from './http'

const respond = (status: number, body: unknown = {}) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  )

const failureOf = async (promise: Promise<unknown>) => {
  try {
    await promise
  } catch (error) {
    if (error instanceof ApiError) return error
  }
  return null
}

const asIs = (raw: unknown) => raw

describe('call', () => {
  it('builds the path from the contract and sends the defined query params only', async () => {
    respond(200, { ok: true })
    const result = await call(
      api.getFeed,
      { query: { vertical: 'lost', species: undefined } },
      asIs,
    )

    expect(result).toEqual({ ok: true })
    const url = vi.mocked(fetch).mock.calls[0]?.[0] as URL
    expect(url.pathname).toBe('/feed')
    expect(url.search).toBe('?vertical=lost')
  })

  it('fills and encodes path parameters', async () => {
    respond(201, { id: 'x' })
    await call(
      api.answerRecoveryClaim,
      { params: { code: '7K3PQ', claimId: 'a/b' }, body: { status: 'confirmed' } },
      asIs,
    )
    const url = vi.mocked(fetch).mock.calls[0]?.[0] as URL
    expect(url.pathname).toBe('/cases/7K3PQ/claims/a%2Fb')
  })

  it.each([
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [404, 'not_found'],
    [409, 'conflict'],
    [422, 'rejected'],
    [429, 'rejected'],
    [410, 'gone'],
    [500, 'server'],
  ])('maps HTTP %i to «%s»', async (status, kind) => {
    respond(status)
    expect((await failureOf(call(api.getCase, { params: { code: 'X' } }, asIs)))?.kind).toBe(kind)
  })

  it('reads the contract’s error code and details from the envelope', async () => {
    respond(409, {
      error: { code: 'active_case_exists', message: 'x', details: { case_code: '7K3PQ' } },
    })
    const error = await failureOf(call(api.getCase, { params: { code: 'X' } }, asIs))
    expect(error?.code).toBe('active_case_exists')
    expect(error?.details).toEqual({ case_code: '7K3PQ' })
  })

  it('still classifies a failure that carries no envelope', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('Bad gateway', { status: 502 })),
    )
    const error = await failureOf(call(api.getConfig, {}, asIs))
    expect(error?.kind).toBe('server')
    expect(error?.code).toBeNull()
  })

  it('maps a failed request to «network»', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')))
    expect((await failureOf(call(api.getConfig, {}, asIs)))?.kind).toBe('network')
  })

  it('maps a body the contract rejects to «unexpected_response»', async () => {
    respond(200, { nope: true })
    const parse = () => {
      throw new Error('bad shape')
    }
    expect((await failureOf(call(api.getConfig, {}, parse)))?.kind).toBe('unexpected_response')
  })

  it('posts a JSON body with the contract’s method', async () => {
    respond(201, { id: 'x' })
    await call(
      api.sendReport,
      { body: { target_type: 'lost_case', target_id: '7K3PQ', reason: 'spam', note: null } },
      asIs,
    )
    const init = vi.mocked(fetch).mock.calls[0]?.[1]
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toMatchObject({ reason: 'spam' })
    expect(init?.credentials).toBe('include')
  })

  it('sends a file as multipart, letting the browser set the boundary', async () => {
    respond(201, { url: 'u' })
    await call(api.uploadPhoto, { body: new Blob(['x'], { type: 'image/jpeg' }) }, asIs)
    const init = vi.mocked(fetch).mock.calls[0]?.[1]
    expect(init?.body).toBeInstanceOf(FormData)
    expect(new Headers(init?.headers).has('Content-Type')).toBe(false)
  })

  it('asks for display text in the language the screen is in', async () => {
    respond(200, {})
    setRequestLanguage('en')
    await call(api.getConfig, {}, asIs)
    const init = vi.mocked(fetch).mock.calls[0]?.[1]
    expect(new Headers(init?.headers).get('Accept-Language')).toBe('en')
  })

  it('accepts an answer with no body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 204 })),
    )
    expect(await call(api.signOut, {}, () => null)).toBeNull()
  })
})
