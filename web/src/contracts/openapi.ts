// api.ts as an OpenAPI 3.1 document: what the real backend implements. Generated, never edited by
// hand — `pnpm openapi` writes it to docs/eng/openapi.json and CI fails when it is stale.
import * as z from 'zod/mini'
import { api, type Endpoint } from './api'
import { ERROR_STATUS, type ErrorCode, errorWire } from './errors'

type JsonSchema = Record<string, unknown>

/** The bare schema: no `$schema`, and no 400-character regex where `format` already says it. */
function schema(source: z.ZodMiniType, io: 'input' | 'output'): JsonSchema {
  const tidy = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(tidy)
    if (!node || typeof node !== 'object') return node
    const out: JsonSchema = {}
    for (const [key, value] of Object.entries(node)) {
      if (key === '$schema') continue
      if (key === 'pattern' && (node as JsonSchema).format === 'date-time') continue
      out[key] = tidy(value)
    }
    return out
  }
  return tidy(z.toJSONSchema(source, { io, unrepresentable: 'any' })) as JsonSchema
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
  if (endpoint.body === 'multipart') {
    return {
      required: true,
      content: {
        'multipart/form-data': {
          schema: {
            type: 'object',
            properties: { file: { type: 'string', format: 'binary' } },
            required: ['file'],
          },
        },
      },
    }
  }
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

export function openApiDocument() {
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
  return {
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
      schemas: { Error: schema(errorWire, 'output') },
      securitySchemes: {
        // O12: an httpOnly cookie on a same-site subdomain. Every request is sent with credentials.
        session: { type: 'apiKey', in: 'cookie', name: 'session' },
      },
    },
  }
}
