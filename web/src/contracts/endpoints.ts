// Every endpoint of the API, one module per area so a screen's bundle carries only the areas it
// calls (a module shared with a lazy screen lands whole in the first load). Read them as
// `api.getCase` (api.ts); conventions: docs/eng/api.md.
export * from './endpoints/account'
export * from './endpoints/adoption'
export * from './endpoints/found'
export * from './endpoints/helpers'
export * from './endpoints/inbox'
export * from './endpoints/lost'
export * from './endpoints/read'
