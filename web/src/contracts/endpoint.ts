// The shape of one contract entry and the helpers entries are written with (endpoints.ts).
import type * as z from 'zod/mini'
import type { ErrorCode } from './errors'

export type Schema = z.ZodMiniType

export type Endpoint = {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  /** `:name` segments are path parameters. */
  path: string
  summary: string
  /** `session` answers `unauthorized` without one. Who may act on what is each endpoint's `forbidden`. */
  auth: 'public' | 'session'
  query: Schema | null
  body: Schema | null
  status: 200 | 201 | 204
  /** Null with 204. */
  response: Schema | null
  /** Beyond the ones any endpoint can answer: `validation_failed`, `rate_limited`, `server_error`. */
  errors: readonly ErrorCode[]
}

type Definition = Pick<Endpoint, 'method' | 'path' | 'summary' | 'auth'> &
  Partial<Pick<Endpoint, 'query' | 'body' | 'status' | 'response' | 'errors'>>

type Defined<D extends Definition> = {
  method: D['method']
  path: D['path']
  summary: string
  auth: D['auth']
  query: D extends { query: infer Q extends Schema } ? Q : null
  body: D extends { body: infer B extends Schema } ? B : null
  status: Endpoint['status']
  response: D extends { response: infer R extends Schema } ? R : null
  errors: readonly ErrorCode[]
}

/** Pure: an entry no screen calls is dropped from that screen's bundle. */
/* @__NO_SIDE_EFFECTS__ */
export function endpoint<const D extends Definition>(definition: D): Defined<D> {
  return {
    query: null,
    body: null,
    response: null,
    errors: [],
    ...definition,
    status: definition.status ?? (definition.response ? 200 : 204),
  } as unknown as Defined<D>
}

export const OWNER_ONLY = ['not_found', 'forbidden', 'invalid_transition'] as const
export const SIGHTING_RULES = [
  'sighting_too_far',
  'seen_at_in_future',
  'seen_at_before_case',
] as const
export const PHONE_STEP = ['invalid_code', 'phone_required'] as const

type Segment<P extends string> = P extends `${infer Name}/${infer Rest}`
  ? Name | PathParam<`/${Rest}`>
  : P
type PathParam<P extends string> = P extends `${string}:${infer After}` ? Segment<After> : never

/** `{ code: string }` for `/cases/:code`; nothing for a path without parameters. */
export type ParamsOf<E extends Endpoint> = { [K in PathParam<E['path']>]: string }
/** What the caller sends. */
export type BodyOf<E extends Endpoint> = E['body'] extends Schema ? z.input<E['body']> : undefined
export type QueryOf<E extends Endpoint> = E['query'] extends Schema
  ? z.input<E['query']>
  : undefined
/** What the server must send: fields with a default may be left out. */
export type WireOf<E extends Endpoint> = E['response'] extends Schema
  ? z.input<E['response']>
  : null

/** `/cases/:code` + `{ code: '7K3PQ' }` → `/cases/7K3PQ`. */
export function buildPath(path: string, params: Record<string, string> = {}): string {
  return path.replace(/:([A-Za-z]+)/g, (_, name: string) => {
    const value = params[name]
    if (value === undefined) throw new Error(`Missing path parameter «${name}» for ${path}`)
    return encodeURIComponent(value)
  })
}
