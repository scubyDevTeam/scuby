// What a helper does without an account (docs/product/04, 05, 09).
import {
  claimWire,
  recoveryClaimRequest,
  reportRequest,
  sightingRequest,
  uploadWire,
} from '../actions'
import { endpoint, SIGHTING_RULES } from '../endpoint'
import { createdWire } from '../primitives'

export const reportSighting = endpoint({
  method: 'POST',
  path: '/cases/:code/sightings',
  summary:
    '«Lo vi»: a pin on a lost or found case. Visible at once; rate-limited per reporter. A ' +
    'repeated `client_id` on the same case answers the sighting it created, before any limit.',
  auth: 'public',
  body: sightingRequest,
  status: 201,
  response: createdWire,
  errors: ['not_found', 'invalid_transition', ...SIGHTING_RULES],
})

export const claimRecovery = endpoint({
  method: 'POST',
  path: '/cases/:code/recovery-claims',
  summary: '«Lo tengo» on a lost case. Creates the claim, then answers the channel to the owner.',
  auth: 'public',
  body: recoveryClaimRequest,
  status: 201,
  response: claimWire,
  errors: ['not_found', 'invalid_transition'],
})

export const sendReport = endpoint({
  method: 'POST',
  path: '/reports',
  summary: 'Flags a publication for review. Anonymous; never hides an active case by itself.',
  auth: 'public',
  body: reportRequest,
  status: 201,
  response: createdWire,
  errors: ['not_found'],
})

export const uploadPhoto = endpoint({
  method: 'POST',
  path: '/uploads',
  summary:
    'Stores one prepared photo (JPEG, ≤ 1600 px) and answers its URL. Provisional: becomes ' +
    'signed upload URLs when the media stack is chosen (O10).',
  auth: 'public',
  body: 'multipart',
  status: 201,
  response: uploadWire,
})
