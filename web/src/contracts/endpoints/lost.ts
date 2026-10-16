// The owner of a lost case (docs/product/04).
import { endpoint, OWNER_ONLY, PHONE_STEP } from '../endpoint'
import {
  answerCheckinRequest,
  answerClaimRequest,
  cancelRequest,
  moderateSightingRequest,
  myCasesWire,
  petsWire,
  publishLostRequest,
  publishWire,
  reuniteRequest,
} from '../owner'
import { createdWire } from '../primitives'

export const listMyPets = endpoint({
  method: 'GET',
  path: '/me/pets',
  summary: 'The pets the caller is responsible for, for «¿Cuál se perdió?».',
  auth: 'session',
  response: petsWire,
})

export const listMyCases = endpoint({
  method: 'GET',
  path: '/me/cases',
  summary: 'Every case the caller published, in any status, newest first.',
  auth: 'session',
  response: myCasesWire,
})

export const publishLost = endpoint({
  method: 'POST',
  path: '/lost-cases',
  summary:
    'Publishes a lost case. Answers `phone_step: otp` when the number must be verified first: ' +
    'send the same body again with `otp_code`.',
  auth: 'session',
  body: publishLostRequest,
  response: publishWire,
  errors: ['active_case_exists', 'not_found', ...PHONE_STEP],
})

export const reuniteCase = endpoint({
  method: 'POST',
  path: '/cases/:code/reunite',
  summary: 'Closes a lost case as reunited. Only its owner, and only while it is active.',
  auth: 'session',
  body: reuniteRequest,
  response: createdWire,
  errors: OWNER_ONLY,
})

export const cancelCase = endpoint({
  method: 'POST',
  path: '/cases/:code/cancel',
  summary: 'Deletes an active lost case (false alarm, duplicate). Pet and owner link survive.',
  auth: 'session',
  body: cancelRequest,
  response: createdWire,
  errors: OWNER_ONLY,
})

export const reopenCase = endpoint({
  method: 'POST',
  path: '/cases/:code/reopen',
  summary:
    'Reactivates an expired case: lost, found or a help request up to 30 days after it expired, ' +
    'an adoption listing up to 90 (adoption timelines are months).',
  auth: 'session',
  response: createdWire,
  errors: OWNER_ONLY,
})

export const answerRecoveryClaim = endpoint({
  method: 'POST',
  path: '/cases/:code/claims/:claimId',
  summary: 'The owner’s verdict on a «lo tengo». Confirming does not close the case: reunite does.',
  auth: 'session',
  body: answerClaimRequest,
  response: createdWire,
  errors: OWNER_ONLY,
})

export const moderateSighting = endpoint({
  method: 'PATCH',
  path: '/cases/:code/sightings/:sightingId',
  summary: 'The owner stars a sighting as useful, or takes it off the public map.',
  auth: 'session',
  body: moderateSightingRequest,
  response: createdWire,
  errors: OWNER_ONLY,
})

export const answerCheckin = endpoint({
  method: 'POST',
  path: '/cases/:code/checkins/:checkinId/answer',
  summary:
    'Answers the pending check-in. `reunited`, `delete` and `claim_confirmed` also end the case ' +
    'or the claim, exactly as their own endpoints would. An adoption listing answers ' +
    '`still_available`; its endings go through `recordAdoption` and `withdrawAdoption`. A help ' +
    'request answers `still_needed`; it ends through `closeHelp`.',
  auth: 'session',
  body: answerCheckinRequest,
  response: createdWire,
  errors: OWNER_ONLY,
})
