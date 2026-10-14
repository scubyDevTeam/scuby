// How the emulated backend answers: through the contract, both ways. A request the contract
// rejects gets the `validation_failed` the real backend would send; an answer the contract rejects
// is a bug in the emulation and fails loudly. Either way the mocks cannot drift from api.ts.
import { delay, HttpResponse, http, type JsonBodyType } from 'msw'
import type * as z from 'zod/mini'
import type { Endpoint, ParamsOf, WireOf } from '../contracts/api'
import { ERROR_STATUS, type ErrorCode } from '../contracts/errors'
import { env } from '../env'
import { type PersonRow, persist, restore, snapshot } from './db'
import { tick } from './followup'
import { currentUser, deviceKey } from './session'

/** What a handler throws to answer with one of its endpoint's errors. */
export class Fail extends Error {
  readonly code: ErrorCode
  readonly details: Record<string, string> | undefined
  readonly fields: Record<string, string> | undefined

  constructor(code: ErrorCode, details?: Record<string, string>, fields?: Record<string, string>) {
    super(code)
    this.code = code
    this.details = details
    this.fields = fields
  }
}

export function fail(code: ErrorCode, details?: Record<string, string>): never {
  throw new Fail(code, details)
}

type Parsed<S> = S extends z.ZodMiniType ? z.output<S> : S extends 'multipart' ? Blob : undefined

export type Context<E extends Endpoint> = {
  params: ParamsOf<E>
  query: Parsed<E['query']>
  body: Parsed<E['body']>
  /** Guaranteed on `session` endpoints: the wrapper answered `unauthorized` already. */
  user: E['auth'] extends 'session' ? PersonRow : PersonRow | null
  /** Who to rate-limit when there is no account. */
  reporterKey: string
}

/** Any endpoint may answer these; the rest must be listed in its `errors`. */
const ALWAYS: ErrorCode[] = ['validation_failed', 'rate_limited', 'server_error']

function errorResponse(code: ErrorCode, message: string, extra: Partial<Fail> = {}) {
  return HttpResponse.json(
    {
      error: {
        code,
        message,
        ...(extra.fields ? { fields: extra.fields } : {}),
        ...(extra.details ? { details: extra.details } : {}),
      },
    },
    { status: ERROR_STATUS[code] },
  )
}

/** A bug in the emulation, not in the caller: shout, and answer what a broken server would. */
function violation(endpoint: Endpoint, problem: string) {
  console.error(
    `[mock backend] ${endpoint.method} ${endpoint.path} breaks the contract: ${problem}`,
  )
  return errorResponse('server_error', `contract violation: ${problem}`)
}

function parseOrFail(schema: z.ZodMiniType, raw: unknown): unknown {
  const parsed = schema.safeParse(raw)
  if (parsed.success) return parsed.data
  const fields: Record<string, string> = {}
  for (const issue of parsed.error.issues) {
    fields[issue.path.join('.') || '(body)'] = issue.message
  }
  throw new Fail('validation_failed', undefined, fields)
}

async function readBody(endpoint: Endpoint, request: Request): Promise<unknown> {
  if (endpoint.body === null) return undefined
  if (endpoint.body === 'multipart') {
    const file = (await request.formData().catch(() => null))?.get('file')
    if (!(file instanceof Blob))
      throw new Fail('validation_failed', undefined, { file: 'Required' })
    return file
  }
  return parseOrFail(endpoint.body, await request.json().catch(() => undefined))
}

/** Every endpoint that has a handler: a test holds it equal to api.ts. */
export const routed = new Set<Endpoint>()

export function route<E extends Endpoint>(
  endpoint: E,
  handle: (context: Context<E>) => WireOf<E> | Promise<WireOf<E>>,
) {
  routed.add(endpoint)
  const method = endpoint.method.toLowerCase() as 'get' | 'post' | 'patch' | 'delete'
  return http[method](
    new URL(endpoint.path, env.apiUrl).toString(),
    async ({ request, params }) => {
      await delay()
      tick()
      // Each request is one transaction: a handler that fails part-way leaves nothing behind.
      const before = snapshot()
      try {
        const user = currentUser()
        if (endpoint.auth === 'session' && !user) throw new Fail('unauthorized')
        const query = endpoint.query
          ? parseOrFail(endpoint.query, Object.fromEntries(new URL(request.url).searchParams))
          : undefined
        const body = await readBody(endpoint, request)
        const result = await handle({
          params: params as ParamsOf<E>,
          query: query as Parsed<E['query']>,
          body: body as Parsed<E['body']>,
          user: user as Context<E>['user'],
          reporterKey: deviceKey(),
        })

        if (endpoint.response === null) return new HttpResponse(null, { status: endpoint.status })
        const checked = endpoint.response.safeParse(result)
        if (!checked.success) return violation(endpoint, checked.error.message)
        return HttpResponse.json(result as JsonBodyType, { status: endpoint.status })
      } catch (error) {
        restore(before)
        if (!(error instanceof Fail)) {
          return violation(endpoint, error instanceof Error ? error.message : String(error))
        }
        const allowed = [
          ...ALWAYS,
          ...endpoint.errors,
          ...(endpoint.auth === 'session' ? ['unauthorized'] : []),
        ]
        if (!allowed.includes(error.code)) {
          return violation(endpoint, `answered «${error.code}», which its errors do not list`)
        }
        return errorResponse(error.code, error.code, error)
      } finally {
        persist()
      }
    },
  )
}
