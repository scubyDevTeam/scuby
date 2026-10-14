// The emulated backend: every endpoint in contracts/api.ts, answered through route() so requests
// and answers are checked against the contract. Swap it for the real backend by setting
// VITE_API_MOCK=false and VITE_API_URL — nothing else in the app changes (docs/eng/api.md).
import { auth } from './api/auth'
import { found } from './api/found'
import { helpers } from './api/helpers'
import { owner } from './api/owner'
import { reads } from './api/reads'

export { DEMO_CODE } from './api/auth'

export const handlers = [...auth, ...reads, ...helpers, ...owner, ...found]
