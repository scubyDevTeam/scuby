// Gives every wire shape its name in the OpenAPI document (decision #34, stage 1): a schema
// registered here is emitted once under `components/schemas` and referenced with `$ref`, so the
// backend's generator makes one type per shape instead of one anonymous class per endpoint.
// The name comes from the export's: `sightingWire` → `Sighting`, `lostStatusSchema` → `LostStatus`,
// `publishLostRequest` → `PublishLostRequest`. Imported by openapi.ts only — never by the client.
import * as z from 'zod/mini'
import * as actions from './actions'
import * as adoption from './adoption'
import * as adoptionCase from './adoption-case'
import * as alerts from './alerts'
import * as _case from './case'
import * as checkin from './checkin'
import * as config from './config'
import * as conversations from './conversations'
import * as edit from './edit'
import * as errors from './errors'
import * as feed from './feed'
import * as found from './found'
import * as foundCase from './found-case'
import * as help from './help'
import * as helpCase from './help-case'
import * as inbox from './inbox'
import * as links from './links'
import * as owner from './owner'
import * as primitives from './primitives'
import * as session from './session'

const MODULES = [
  actions,
  adoption,
  adoptionCase,
  alerts,
  _case,
  checkin,
  config,
  conversations,
  edit,
  errors,
  feed,
  found,
  foundCase,
  help,
  helpCase,
  inbox,
  links,
  owner,
  primitives,
  session,
] as const

/** `sightingWire` → `Sighting`; `publishLostRequest` stays whole; `...Schema` loses its suffix. */
export function schemaName(exportName: string): string {
  const base = exportName.replace(/(Wire|Schema)$/, '')
  return base.charAt(0).toUpperCase() + base.slice(1)
}

const isSchema = (value: unknown): value is z.ZodMiniType =>
  typeof value === 'object' && value !== null && '_zod' in value

let registered = false

/** Idempotent: the same schema exported from two modules is named once. */
export function nameSchemas(): void {
  if (registered) return
  registered = true
  const seen = new Set<unknown>()
  const used = new Map<string, string>()
  for (const module of MODULES) {
    for (const [exportName, value] of Object.entries(module)) {
      if (!/(Wire|Schema|Request)$/.test(exportName) || !isSchema(value) || seen.has(value))
        continue
      seen.add(value)
      const id = schemaName(exportName)
      const clash = used.get(id)
      if (clash) throw new Error(`Schema name ${id} is taken by ${clash} and ${exportName}`)
      used.set(id, exportName)
      z.globalRegistry.add(value, { ...z.globalRegistry.get(value), id })
    }
  }
}
