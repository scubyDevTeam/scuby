// Adoption (docs/product/06).
import {
  answerInterestRequest,
  interestRequest,
  interestWire,
  publishAdoptionRequest,
  recordAdoptionRequest,
  withdrawAdoptionRequest,
} from '../adoption'
import { endpoint, OWNER_ONLY, PHONE_STEP } from '../endpoint'
import { publishWire } from '../owner'
import { createdWire } from '../primitives'

export const publishAdoption = endpoint({
  method: 'POST',
  path: '/adoption-cases',
  summary:
    'Publishes an adoption listing, with the same phone step as every publish. With ' +
    '`from_found_case_code` it is the day-15 conversion of the caller’s found case: same pet, ' +
    'the found case `converted`.',
  auth: 'session',
  body: publishAdoptionRequest,
  response: publishWire,
  errors: ['not_found', 'forbidden', 'invalid_transition', ...PHONE_STEP],
})

export const expressInterest = endpoint({
  method: 'POST',
  path: '/cases/:code/interests',
  summary:
    '«Me interesa»: the intro row first, then the channels the lister enabled. One per person ' +
    'per listing — asking again answers the same row (a withdrawn one comes back open). Needs ' +
    'a verified number, with the publish phone step.',
  auth: 'session',
  body: interestRequest,
  response: interestWire,
  errors: ['not_found', 'forbidden', 'invalid_transition', ...PHONE_STEP],
})

export const withdrawInterest = endpoint({
  method: 'POST',
  path: '/cases/:code/interests/:interestId/withdraw',
  summary: '«Ya no me interesa»: one tap, and the interest leaves the lister’s list.',
  auth: 'session',
  response: createdWire,
  errors: OWNER_ONLY,
})

export const answerInterest = endpoint({
  method: 'POST',
  path: '/cases/:code/interests/:interestId',
  summary:
    'The lister marks an interest chosen («En proceso» in public, one at a time), declines it ' +
    '(silent to the adopter) or puts it back on the list («No se concretó»).',
  auth: 'session',
  body: answerInterestRequest,
  response: createdWire,
  errors: OWNER_ONLY,
})

export const recordAdoption = endpoint({
  method: 'POST',
  path: '/cases/:code/adopt',
  summary:
    '«¿Quién lo adoptó?»: an interest (`adopted_in_app` — the responsibility moves to that ' +
    'person) or nobody on the platform (`adopted_offline`). Ends the listing.',
  auth: 'session',
  body: recordAdoptionRequest,
  response: createdWire,
  errors: OWNER_ONLY,
})

export const withdrawAdoption = endpoint({
  method: 'POST',
  path: '/cases/:code/withdraw',
  summary: 'Takes an adoption listing down, with its reason. Pet and lister link are untouched.',
  auth: 'session',
  body: withdrawAdoptionRequest,
  response: createdWire,
  errors: OWNER_ONLY,
})
