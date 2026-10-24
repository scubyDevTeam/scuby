// api.ts as an OpenAPI 3.1 document: what the real backend implements. Generated, never edited by
// hand — `pnpm openapi` writes it to docs/eng/openapi.json and CI fails when it is stale.
import * as z from 'zod/mini'
import { api, type Endpoint } from './api'
import { ERROR_STATUS, type ErrorCode, errorWire } from './errors'
import { nameSchemas } from './names'

type JsonSchema = Record<string, unknown>

/** Named shapes found while converting, by io. A shape a default changes (a request may omit what
 * a response always carries) reads differently each way: the response keeps `Name`, the request
 * becomes `NameInput` — see `resolveNames`. */
const named = { input: new Map<string, JsonSchema>(), output: new Map<string, JsonSchema>() }

const INPUT_MARK = '~in'

const DEFS = '#/$defs/'
const COMPONENTS = '#/components/schemas/'

/** The bare schema: no `$schema`, no 400-character regex where `format` already says it, and every
 * registered shape (names.ts) hoisted into `components/schemas` and referenced by `$ref`. */
function schema(source: z.ZodMiniType, io: 'input' | 'output'): JsonSchema {
  const tidy = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(tidy)
    if (!node || typeof node !== 'object') return node
    const out: JsonSchema = {}
    for (const [key, value] of Object.entries(node)) {
      if (key === '$schema' || key === '$defs') continue
      if (key === 'pattern' && (node as JsonSchema).format === 'date-time') continue
      if (key === '$ref' && typeof value === 'string' && value.startsWith(DEFS)) {
        out[key] = COMPONENTS + value.slice(DEFS.length) + (io === 'input' ? INPUT_MARK : '')
        continue
      }
      out[key] = tidy(value)
    }
    return out
  }
  const json = z.toJSONSchema(source, {
    io,
    unrepresentable: 'any',
    reused: 'inline',
  }) as JsonSchema
  for (const [name, def] of Object.entries((json.$defs ?? {}) as Record<string, unknown>)) {
    named[io].set(name, tidy(def) as JsonSchema)
  }
  return tidy(json) as JsonSchema
}

const ALWAYS: ErrorCode[] = ['validation_failed', 'rate_limited', 'server_error']

function errorResponses(endpoint: Endpoint) {
  const codes = [
    ...(endpoint.auth === 'session' ? (['unauthorized'] as const) : []),
    ...endpoint.errors,
    ...ALWAYS,
  ]
  const byStatus = new Map<number, ErrorCode[]>()
  for (const code of new Set(codes)) {
    const status = ERROR_STATUS[code]
    byStatus.set(status, [...(byStatus.get(status) ?? []), code])
  }
  return Object.fromEntries(
    [...byStatus.entries()]
      .sort(([a], [b]) => a - b)
      .map(([status, list]) => [
        String(status),
        {
          description: `\`error.code\`: ${list.map((c) => `\`${c}\``).join(', ')}`,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
      ]),
  )
}

function parameters(endpoint: Endpoint) {
  const path = [...endpoint.path.matchAll(/:([A-Za-z]+)/g)].map(([, name]) => ({
    name,
    in: 'path',
    required: true,
    schema: { type: 'string' },
  }))
  if (!endpoint.query) return path
  const query = schema(endpoint.query, 'output') as {
    properties?: Record<string, JsonSchema>
    required?: string[]
  }
  return [
    ...path,
    ...Object.entries(query.properties ?? {}).map(([name, property]) => ({
      name,
      in: 'query',
      required: query.required?.includes(name) ?? false,
      schema: property,
    })),
  ]
}

function requestBody(endpoint: Endpoint) {
  if (endpoint.body === null) return undefined
  return {
    required: true,
    content: { 'application/json': { schema: schema(endpoint.body, 'input') } },
  }
}

function success(endpoint: Endpoint) {
  if (endpoint.response === null) return { description: 'No content' }
  return {
    description: 'OK',
    // Output side: what the server sends is complete — every field present, defaults included.
    content: { 'application/json': { schema: schema(endpoint.response, 'output') } },
  }
}

const refTo = (name: string, mark = '') => `${COMPONENTS}${name}${mark}"`

/** Settles which shapes read differently as input and as output: those whose two forms differ, and
 * (to a fixpoint) those that hold one. Input references to them become `NameInput`. */
function resolveNames() {
  const unmarked = (value: JsonSchema) => JSON.stringify(value).split(`${INPUT_MARK}"`).join('"')
  const divergent = new Set<string>()
  for (const [name, input] of named.input) {
    const output = named.output.get(name)
    if (output && unmarked(input) !== JSON.stringify(output)) divergent.add(name)
  }
  for (let changed = true; changed; ) {
    changed = false
    for (const [name, input] of named.input) {
      if (divergent.has(name)) continue
      const text = JSON.stringify(input)
      if ([...divergent].some((other) => text.includes(refTo(other, INPUT_MARK)))) {
        divergent.add(name)
        changed = true
      }
    }
  }
  const rename = <T>(value: T): T =>
    JSON.parse(
      JSON.stringify(value).replace(
        new RegExp(`${COMPONENTS}(\\w+)${INPUT_MARK}"`, 'g'),
        (_, n: string) => refTo(n, divergent.has(n) ? 'Input' : '').replace(/"$/, '') + '"',
      ),
    )
  const all: Record<string, JsonSchema> = {}
  for (const [name, def] of named.output) all[name] = def
  for (const [name, input] of named.input) {
    if (divergent.has(name)) all[`${name}Input`] = input
    else if (!(name in all)) all[name] = input
  }
  return { schemas: rename(all), rename }
}

export function openApiDocument() {
  nameSchemas()
  named.input.clear()
  named.output.clear()
  const paths: Record<string, Record<string, unknown>> = {}
  for (const [name, endpoint] of Object.entries(api) as [string, Endpoint][]) {
    const path = endpoint.path.replace(/:([A-Za-z]+)/g, '{$1}')
    const tag = endpoint.path.split('/')[1] ?? 'root'
    paths[path] ??= {}
    paths[path][endpoint.method.toLowerCase()] = {
      operationId: name,
      summary: endpoint.summary,
      tags: [tag],
      security: endpoint.auth === 'session' ? [{ session: [] }] : [],
      parameters: parameters(endpoint),
      ...(requestBody(endpoint) ? { requestBody: requestBody(endpoint) } : {}),
      responses: { [String(endpoint.status)]: success(endpoint), ...errorResponses(endpoint) },
    }
  }
  schema(errorWire, 'output') // registers `Error` (names.ts) — the envelope every failure shares
  const { schemas, rename } = resolveNames()
  // A shape only used flattened (query parameters), or only as the other form, has no reference.
  const used = JSON.stringify(rename([paths, schemas]))
  const sorted = Object.entries(schemas)
    .filter(([name]) => name === 'Error' || used.includes(refTo(name)))
    .sort(([x], [y]) => x.localeCompare(y))
  return rename({
    openapi: '3.1.0',
    info: {
      // The product name is configuration (decision #21): the document does not spell it.
      title: 'API',
      version: '0.1.0',
      description:
        'Generated from web/src/contracts/api.ts — do not edit. Conventions: docs/eng/api.md.',
    },
    paths,
    components: {
      schemas: Object.fromEntries(sorted),
      securitySchemes: {
        // Decision #37: an httpOnly cookie on a same-site subdomain. Every request is sent with credentials.
        session: { type: 'apiKey', in: 'cookie', name: 'session' },
        // Decision #35: who someone is without an account. Never required — the API sets it on the
        // first answer to a request that arrives without one, and the browser sends it back.
        device: {
          type: 'apiKey',
          in: 'cookie',
          name: 'device',
          description:
            'Opaque, httpOnly, set by the API (docs/eng/api.md · Device identity). Identifies an ' +
            'anonymous reporter or claimant: authorizes correcting their own sighting, marks it ' +
            '`mine`, keys rate limits. Absent or unknown → the API issues a new one.',
        },
      },
    },
  })
}
