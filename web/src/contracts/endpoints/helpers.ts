// What a helper does without an account (docs/product/04, 05, 09).
import {
  claimWire,
  recoveryClaimRequest,
  reportRequest,
  shareOpenedRequest,
  sightingCorrectionRequest,
  sightingRequest,
  uploadRequest,
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

export const correctSighting = endpoint({
  method: 'POST',
  path: '/cases/:code/sightings/:sightingId/correction',
  summary:
    '«Corregir»: moves the reporter’s own pin and its time, no new row. Only its reporter, only ' +
    'until `editable_until` (`created_at + 15 min`); the same distance and time checks as a new pin.',
  auth: 'public',
  body: sightingCorrectionRequest,
  errors: ['not_found', 'forbidden', 'invalid_transition', ...SIGHTING_RULES],
})

export const deleteSighting = endpoint({
  method: 'DELETE',
  path: '/cases/:code/sightings/:sightingId',
  summary:
    'Deletes the reporter’s own pin. Only its reporter, only until `editable_until`; after that ' +
    'only the owner (hide) or moderation (remove) can take it off the map.',
  auth: 'public',
  errors: ['not_found', 'forbidden'],
})

export const claimRecovery = endpoint({
  method: 'POST',
  path: '/cases/:code/recovery-claims',
  summary:
    '«Lo tengo» on a lost case. Needs a session: the claimant is a person, for the owner’s safety (say so in the UI). ' +
    'The case’s owner cannot claim it. Creates the claim, then answers the channel to the owner; a repeated claim by ' +
    'the same person refreshes their open one (the new phone always; photos and pin only when sent; it counts as fresh again) and answers ' +
    'its id; once the owner has answered it, a repeat answers that same claim unchanged (one claim per person per case). A `from_sighting_id` that is not the caller’s own visible pin of the last 24 hours is ignored, never ' +
    'refused. On a case archived less than 30 days ago it reactivates it first (decision #29) when it is the pet’s newest case, unless the pet has ' +
    'another active case (`active_case_exists`).',
  auth: 'session',
  body: recoveryClaimRequest,
  status: 201,
  response: claimWire,
  errors: ['not_found', 'forbidden', 'invalid_transition', 'active_case_exists', 'gone'],
})

export const recordShare = endpoint({
  method: 'POST',
  path: '/cases/:code/shares',
  summary:
    '`share.opened` (10 §5): someone opened a way to share the case — the system sheet, WhatsApp ' +
    'or a download. Anonymous; an unknown code is ignored. The client never waits for it.',
  auth: 'public',
  body: shareOpenedRequest,
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
    'Asks for a slot to store one prepared photo (JPEG, ≤ 1600 px): a short-lived presigned PUT ' +
    'signed with the photo’s SHA-256, scoped to what the photo is for and to who asks. The answer ' +
    'also carries the photo’s final URL; `upload` is null when that exact photo is already stored. ' +
    'A photo in a publish body that this caller did not upload for that purpose is refused.',
  auth: 'public',
  body: uploadRequest,
  status: 201,
  response: uploadWire,
})
