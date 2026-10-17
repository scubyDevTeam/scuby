// Correcting a published found, adoption or help case (docs/product/00 · #27).
import { editCaseRequest } from '../edit'
import { endpoint, OWNER_ONLY } from '../endpoint'

export const editCase = endpoint({
  method: 'PATCH',
  path: '/cases/:code',
  summary:
    'Corrects an active found, adoption or help case: photos, signs, story, and for an adoption ' +
    'its temperament and requirements. Only its publisher. Fields left out stay; a field the ' +
    'vertical has no use for is `validation_failed`. Never re-broadcasts. A lost case uses `editLost`.',
  auth: 'session',
  body: editCaseRequest,
  errors: OWNER_ONLY,
})
