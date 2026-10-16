// Help in kind (docs/product/07; decision #26).
import { endpoint, OWNER_ONLY, PHONE_STEP } from '../endpoint'
import {
  answerPledgeRequest,
  closeHelpRequest,
  pledgeRequest,
  pledgeWire,
  publishHelpRequest,
} from '../help'
import { publishWire } from '../owner'
import { createdWire } from '../primitives'

export const publishHelp = endpoint({
  method: 'POST',
  path: '/help-requests',
  summary:
    'Publishes a help request — one to three needs in kind (`foster`, `transport`, `supplies`) for a ' +
    'pet the caller holds — with the phone step of every publish. With `pet_id: null` the pet is ' +
    'created and its owner link opens. Starts `unverified`, labelled so; nothing waits on review.',
  auth: 'session',
  body: publishHelpRequest,
  response: publishWire,
  errors: ['not_found', ...PHONE_STEP],
})

export const pledgeHelp = endpoint({
  method: 'POST',
  path: '/cases/:code/pledges',
  summary:
    '«Yo ayudo» on one need: the pledge row first, then the channel to the beneficiary. Needs a ' +
    'reachable number — a foster we cannot reach is not a foster — with the publish phone step. ' +
    'The beneficiary cannot pledge to their own request.',
  auth: 'session',
  body: pledgeRequest,
  response: pledgeWire,
  errors: ['not_found', 'forbidden', 'invalid_transition', ...PHONE_STEP],
})

export const withdrawPledge = endpoint({
  method: 'POST',
  path: '/cases/:code/pledges/:pledgeId/withdraw',
  summary: '«Ya no puedo»: the pledger takes back an offer the beneficiary has not confirmed yet.',
  auth: 'session',
  response: createdWire,
  errors: OWNER_ONLY,
})

export const answerPledge = endpoint({
  method: 'POST',
  path: '/cases/:code/pledges/:pledgeId',
  summary:
    'The beneficiary says what arrived: `confirmed` (the ride happened, the food arrived) or ' +
    '`declined`. Final either way. Confirmations that reach a need’s target cover it; every need ' +
    'covered closes the request as `covered`.',
  auth: 'session',
  body: answerPledgeRequest,
  response: createdWire,
  errors: OWNER_ONLY,
})

export const coverNeed = endpoint({
  method: 'POST',
  path: '/cases/:code/needs/:needId/cover',
  summary:
    'The beneficiary marks one need covered by their word — the way a «lo que puedan» need ends. ' +
    'Every need covered closes the request.',
  auth: 'session',
  response: createdWire,
  errors: OWNER_ONLY,
})

export const closeHelp = endpoint({
  method: 'POST',
  path: '/cases/:code/close',
  summary:
    '«Ya no necesita ayuda», with its reason. Pledgers with an open pledge are told. Pet and links ' +
    'are untouched.',
  auth: 'session',
  body: closeHelpRequest,
  response: createdWire,
  errors: OWNER_ONLY,
})
