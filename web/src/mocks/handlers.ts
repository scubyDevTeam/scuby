// The emulated backend: every endpoint in contracts/api.ts, answered through route() so requests
// and answers are checked against the contract. Swap it for the real backend by setting
// VITE_API_MOCK=false and VITE_API_URL — nothing else in the app changes (docs/eng/api.md).
import { adoption } from './api/adoption'
import { alerts } from './api/alerts'
import { auth } from './api/auth'
import { conversations } from './api/conversations'
import { edit } from './api/edit'
import { found } from './api/found'
import { help } from './api/help'
import { helpers } from './api/helpers'
import { links } from './api/links'
import { owner } from './api/owner'
import { reads } from './api/reads'

export { DEMO_CODE } from './api/auth'

export const handlers = [
  ...auth,
  ...reads,
  ...helpers,
  ...owner,
  ...found,
  ...adoption,
  ...help,
  ...links,
  ...conversations,
  ...alerts,
  ...edit,
]
