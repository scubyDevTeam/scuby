// Found (docs/product/05).
import { claimWire } from '../actions'
import { endpoint, OWNER_ONLY, PHONE_STEP } from '../endpoint'
import {
  candidatesWire,
  matchRequest,
  orphanSightingRequest,
  ownershipClaimRequest,
  publishFoundRequest,
  resolveFoundRequest,
} from '../found'
import { answerClaimRequest, publishWire } from '../owner'
import { createdWire } from '../primitives'

export const matchAnimal = endpoint({
  method: 'POST',
  path: '/matches',
  summary: 'Lost pets a found animal could be, each with its reasons. A person always confirms.',
  auth: 'public',
  body: matchRequest,
  response: candidatesWire,
})

export const publishFound = endpoint({
  method: 'POST',
  path: '/found-cases',
  summary: 'Publishes a found case. Same phone step as publishing a lost one.',
  auth: 'session',
  body: publishFoundRequest,
  response: publishWire,
  errors: PHONE_STEP,
})

export const claimOwnership = endpoint({
  method: 'POST',
  path: '/cases/:code/ownership-claims',
  summary: '«Es mío» on a found case. Never anonymous: it asks to take an animal.',
  auth: 'session',
  body: ownershipClaimRequest,
  status: 201,
  response: claimWire,
  errors: ['not_found', 'invalid_transition'],
})

export const answerOwnershipClaim = endpoint({
  method: 'POST',
  path: '/cases/:code/ownership-claims/:claimId',
  summary: 'The custodian’s verdict on an «es mío».',
  auth: 'session',
  body: answerClaimRequest,
  response: createdWire,
  errors: OWNER_ONLY,
})

export const resolveFound = endpoint({
  method: 'POST',
  path: '/cases/:code/resolve',
  summary: 'How a custodian ends a found case — or keeps looking and re-arms the hold clock.',
  auth: 'session',
  body: resolveFoundRequest,
  response: createdWire,
  errors: OWNER_ONLY,
})

export const reportOrphanSighting = endpoint({
  method: 'POST',
  path: '/sightings',
  summary: 'A witness report with no case to attach to: kept and matched against later cases.',
  auth: 'public',
  body: orphanSightingRequest,
  status: 201,
  response: createdWire,
  errors: ['seen_at_in_future'],
})
