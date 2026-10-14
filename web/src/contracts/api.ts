// The API, one entry per endpoint. This file is the contract: the client calls through it
// (api-client), the emulated backend answers through it (mocks) and the OpenAPI document the real
// backend implements is generated from it (openapi.ts → docs/eng/openapi.json).
// Conventions — sessions, errors, what the server decides: docs/eng/api.md.
// Mechanics: the entry shape in endpoint.ts, the entries in endpoints.ts — one export each, so the
// bundler leaves out the schemas of endpoints a screen never calls.
import type * as endpoints from './endpoints'

export {
  type BodyOf,
  buildPath,
  type Endpoint,
  type ParamsOf,
  type QueryOf,
  type WireOf,
} from './endpoint'
export * as api from './endpoints'

export type EndpointName = keyof typeof endpoints
