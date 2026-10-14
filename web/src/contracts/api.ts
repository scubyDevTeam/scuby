// The API, one entry per endpoint. This file is the contract: the client calls through it
// (api-client), the emulated backend answers through it (mocks) and the OpenAPI document the real
// backend implements is generated from it (openapi.ts → docs/eng/api/openapi.json).
// Conventions — sessions, errors, what the server decides: docs/eng/api.md.
import type * as z from 'zod/mini'
import { claimWire, recoveryClaimRequest, reportRequest, sightingRequest } from './actions'
import { caseWire } from './case'
import { configWire } from './config'
import type { ErrorCode } from './errors'
import { feedQuerySchema, feedWire } from './feed'
import {
  candidatesWire,
  matchRequest,
  orphanSightingRequest,
  ownershipClaimRequest,
  publishFoundRequest,
  resolveFoundRequest,
} from './found'
import {
  answerCheckinRequest,
  answerClaimRequest,
  cancelRequest,
  moderateSightingRequest,
  myCasesWire,
  notificationsWire,
  petsWire,
  publishLostRequest,
  publishWire,
  readNotificationsRequest,
  reuniteRequest,
  uploadWire,
} from './owner'
import { createdWire } from './primitives'
import {
  emailStartRequest,
  emailVerifyRequest,
  googleSignInRequest,
  profileUpdateRequest,
  profileWire,
  pushSubscriptionRequest,
  userWire,
} from './session'

type Schema = z.ZodMiniType

export type Endpoint = {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  /** `:name` segments are path parameters. */
  path: string
  summary: string
  /** `session` answers `unauthorized` without one. Who may act on what is each endpoint's `forbidden`. */
  auth: 'public' | 'session'
  query: Schema | null
  /** JSON, or `multipart` for the one endpoint that takes a file (field `file`). */
  body: Schema | 'multipart' | null
  status: 200 | 201 | 204
  /** Null with 204. */
  response: Schema | null
  /** Beyond the ones any endpoint can answer: `validation_failed`, `rate_limited`, `server_error`. */
  errors: readonly ErrorCode[]
}

type Definition = Pick<Endpoint, 'method' | 'path' | 'summary' | 'auth'> &
  Partial<Pick<Endpoint, 'query' | 'body' | 'status' | 'response' | 'errors'>>

type Defined<D extends Definition> = {
  method: D['method']
  path: D['path']
  summary: string
  auth: D['auth']
  query: D extends { query: infer Q extends Schema } ? Q : null
  body: D extends { body: infer B extends Schema | 'multipart' } ? B : null
  status: Endpoint['status']
  response: D extends { response: infer R extends Schema } ? R : null
  errors: readonly ErrorCode[]
}

function endpoint<const D extends Definition>(definition: D): Defined<D> {
  return {
    query: null,
    body: null,
    response: null,
    errors: [],
    ...definition,
    status: definition.status ?? (definition.response ? 200 : 204),
  } as unknown as Defined<D>
}

const OWNER_ONLY = ['not_found', 'forbidden', 'invalid_transition'] as const
const SIGHTING_RULES = ['sighting_too_far', 'seen_at_in_future', 'seen_at_before_case'] as const
const PHONE_STEP = ['invalid_code', 'phone_required'] as const

export const api = {
  // --- Sign-in and the account (docs/eng/auth.md) ---
  getSession: endpoint({
    method: 'GET',
    path: '/session',
    summary: 'Who is signed in. `unauthorized` means nobody, which is an answer and not a fault.',
    auth: 'session',
    response: userWire,
  }),
  startEmailCode: endpoint({
    method: 'POST',
    path: '/auth/email/start',
    summary: 'Emails a 6-digit code. Always 204, so the endpoint cannot be used to probe accounts.',
    auth: 'public',
    body: emailStartRequest,
  }),
  verifyEmailCode: endpoint({
    method: 'POST',
    path: '/auth/email/verify',
    summary: 'Trades the emailed code for a session; the account is created on its first sign-in.',
    auth: 'public',
    body: emailVerifyRequest,
    response: userWire,
    errors: ['invalid_code'],
  }),
  googleSignIn: endpoint({
    method: 'POST',
    path: '/auth/google',
    summary:
      'Trades a Google ID token for a session. `unauthorized` when Google rejects the token.',
    auth: 'public',
    body: googleSignInRequest,
    response: userWire,
    errors: ['unauthorized'],
  }),
  signOut: endpoint({
    method: 'POST',
    path: '/auth/sign-out',
    summary: 'Ends the session. 204 whether or not there was one.',
    auth: 'public',
  }),
  getProfile: endpoint({
    method: 'GET',
    path: '/me/profile',
    summary: 'The account as its owner edits it.',
    auth: 'session',
    response: profileWire,
  }),
  updateProfile: endpoint({
    method: 'PATCH',
    path: '/me/profile',
    summary: 'Changes the fields sent and answers the whole profile.',
    auth: 'session',
    body: profileUpdateRequest,
    response: profileWire,
  }),
  registerPush: endpoint({
    method: 'POST',
    path: '/me/push-subscriptions',
    summary: 'Registers this install for push. Registering the same token again is not an error.',
    auth: 'session',
    body: pushSubscriptionRequest,
    status: 201,
    response: createdWire,
  }),
  unregisterPush: endpoint({
    method: 'DELETE',
    path: '/me/push-subscriptions/:id',
    summary: 'Stops push to one install.',
    auth: 'session',
    errors: ['not_found'],
  }),
  listNotifications: endpoint({
    method: 'GET',
    path: '/me/notifications',
    summary: 'The in-app inbox, newest first: a copy of every notification sent to this account.',
    auth: 'session',
    response: notificationsWire,
  }),
  readNotifications: endpoint({
    method: 'POST',
    path: '/me/notifications/read',
    summary: 'Marks notifications as read: the ones named, or all of them.',
    auth: 'session',
    body: readNotificationsRequest,
  }),

  // --- What anyone reads (docs/product/04, 05, 10) ---
  getConfig: endpoint({
    method: 'GET',
    path: '/config',
    summary: 'The countries the product runs in.',
    auth: 'public',
    response: configWire,
  }),
  getCase: endpoint({
    method: 'GET',
    path: '/cases/:code',
    summary:
      'A case by its short code. The same URL answers more to the person responsible for it ' +
      '(`viewer`): claims, hidden pins, reporters’ numbers, the pending check-in, the withheld detail.',
    auth: 'public',
    response: caseWire,
    errors: ['not_found', 'gone'],
  }),
  getFeed: endpoint({
    method: 'GET',
    path: '/feed',
    summary:
      'Open cases, newest first: near `lat`/`lng`, or the whole country when nothing is near.',
    auth: 'public',
    query: feedQuerySchema,
    response: feedWire,
  }),

  // --- What a helper does without an account (docs/product/04, 05, 09) ---
  reportSighting: endpoint({
    method: 'POST',
    path: '/cases/:code/sightings',
    summary: '«Lo vi»: a pin on a lost or found case. Visible at once; rate-limited per reporter.',
    auth: 'public',
    body: sightingRequest,
    status: 201,
    response: createdWire,
    errors: ['not_found', 'invalid_transition', ...SIGHTING_RULES],
  }),
  reportOrphanSighting: endpoint({
    method: 'POST',
    path: '/sightings',
    summary: 'A witness report with no case to attach to: kept and matched against later cases.',
    auth: 'public',
    body: orphanSightingRequest,
    status: 201,
    response: createdWire,
    errors: ['seen_at_in_future'],
  }),
  claimRecovery: endpoint({
    method: 'POST',
    path: '/cases/:code/recovery-claims',
    summary: '«Lo tengo» on a lost case. Creates the claim, then answers the channel to the owner.',
    auth: 'public',
    body: recoveryClaimRequest,
    status: 201,
    response: claimWire,
    errors: ['not_found', 'invalid_transition'],
  }),
  sendReport: endpoint({
    method: 'POST',
    path: '/reports',
    summary: 'Flags a publication for review. Anonymous; never hides an active case by itself.',
    auth: 'public',
    body: reportRequest,
    status: 201,
    response: createdWire,
    errors: ['not_found'],
  }),
  uploadPhoto: endpoint({
    method: 'POST',
    path: '/uploads',
    summary:
      'Stores one prepared photo (JPEG, ≤ 1600 px) and answers its URL. Provisional: becomes ' +
      'signed upload URLs when the media stack is chosen (O10).',
    auth: 'public',
    body: 'multipart',
    status: 201,
    response: uploadWire,
  }),

  // --- The owner of a lost case (docs/product/04) ---
  listMyPets: endpoint({
    method: 'GET',
    path: '/me/pets',
    summary: 'The pets the caller is responsible for, for «¿Cuál se perdió?».',
    auth: 'session',
    response: petsWire,
  }),
  listMyCases: endpoint({
    method: 'GET',
    path: '/me/cases',
    summary: 'Every case the caller published, in any status, newest first.',
    auth: 'session',
    response: myCasesWire,
  }),
  publishLost: endpoint({
    method: 'POST',
    path: '/lost-cases',
    summary:
      'Publishes a lost case. Answers `phone_step: otp` when the number must be verified first: ' +
      'send the same body again with `otp_code`.',
    auth: 'session',
    body: publishLostRequest,
    response: publishWire,
    errors: ['active_case_exists', 'not_found', ...PHONE_STEP],
  }),
  reuniteCase: endpoint({
    method: 'POST',
    path: '/cases/:code/reunite',
    summary: 'Closes a lost case as reunited. Only its owner, and only while it is active.',
    auth: 'session',
    body: reuniteRequest,
    response: createdWire,
    errors: OWNER_ONLY,
  }),
  cancelCase: endpoint({
    method: 'POST',
    path: '/cases/:code/cancel',
    summary: 'Deletes an active lost case (false alarm, duplicate). Pet and owner link survive.',
    auth: 'session',
    body: cancelRequest,
    response: createdWire,
    errors: OWNER_ONLY,
  }),
  reopenCase: endpoint({
    method: 'POST',
    path: '/cases/:code/reopen',
    summary: 'Reactivates an expired lost or found case, up to 30 days after it expired.',
    auth: 'session',
    response: createdWire,
    errors: OWNER_ONLY,
  }),
  answerRecoveryClaim: endpoint({
    method: 'POST',
    path: '/cases/:code/claims/:claimId',
    summary:
      'The owner’s verdict on a «lo tengo». Confirming does not close the case: reunite does.',
    auth: 'session',
    body: answerClaimRequest,
    response: createdWire,
    errors: OWNER_ONLY,
  }),
  moderateSighting: endpoint({
    method: 'PATCH',
    path: '/cases/:code/sightings/:sightingId',
    summary: 'The owner stars a sighting as useful, or takes it off the public map.',
    auth: 'session',
    body: moderateSightingRequest,
    response: createdWire,
    errors: OWNER_ONLY,
  }),
  answerCheckin: endpoint({
    method: 'POST',
    path: '/cases/:code/checkins/:checkinId/answer',
    summary:
      'Answers the pending check-in. `reunited`, `delete` and `claim_confirmed` also end the case ' +
      'or the claim, exactly as their own endpoints would.',
    auth: 'session',
    body: answerCheckinRequest,
    response: createdWire,
    errors: OWNER_ONLY,
  }),

  // --- Found (docs/product/05) ---
  matchAnimal: endpoint({
    method: 'POST',
    path: '/matches',
    summary: 'Lost pets a found animal could be, each with its reasons. A person always confirms.',
    auth: 'public',
    body: matchRequest,
    response: candidatesWire,
  }),
  publishFound: endpoint({
    method: 'POST',
    path: '/found-cases',
    summary: 'Publishes a found case. Same phone step as publishing a lost one.',
    auth: 'session',
    body: publishFoundRequest,
    response: publishWire,
    errors: PHONE_STEP,
  }),
  claimOwnership: endpoint({
    method: 'POST',
    path: '/cases/:code/ownership-claims',
    summary: '«Es mío» on a found case. Never anonymous: it asks to take an animal.',
    auth: 'session',
    body: ownershipClaimRequest,
    status: 201,
    response: claimWire,
    errors: ['not_found', 'invalid_transition'],
  }),
  answerOwnershipClaim: endpoint({
    method: 'POST',
    path: '/cases/:code/ownership-claims/:claimId',
    summary: 'The custodian’s verdict on an «es mío».',
    auth: 'session',
    body: answerClaimRequest,
    response: createdWire,
    errors: OWNER_ONLY,
  }),
  resolveFound: endpoint({
    method: 'POST',
    path: '/cases/:code/resolve',
    summary: 'How a custodian ends a found case — or keeps looking and re-arms the hold clock.',
    auth: 'session',
    body: resolveFoundRequest,
    response: createdWire,
    errors: OWNER_ONLY,
  }),
} as const

export type EndpointName = keyof typeof api

type Segment<P extends string> = P extends `${infer Name}/${infer Rest}`
  ? Name | PathParam<`/${Rest}`>
  : P
type PathParam<P extends string> = P extends `${string}:${infer After}` ? Segment<After> : never

/** `{ code: string }` for `/cases/:code`; nothing for a path without parameters. */
export type ParamsOf<E extends Endpoint> = { [K in PathParam<E['path']>]: string }
/** What the caller sends. */
export type BodyOf<E extends Endpoint> = E['body'] extends Schema
  ? z.input<E['body']>
  : E['body'] extends 'multipart'
    ? Blob
    : undefined
export type QueryOf<E extends Endpoint> = E['query'] extends Schema
  ? z.input<E['query']>
  : undefined
/** What the server must send: fields with a default may be left out. */
export type WireOf<E extends Endpoint> = E['response'] extends Schema
  ? z.input<E['response']>
  : null

/** `/cases/:code` + `{ code: '7K3PQ' }` → `/cases/7K3PQ`. */
export function buildPath(path: string, params: Record<string, string> = {}): string {
  return path.replace(/:([A-Za-z]+)/g, (_, name: string) => {
    const value = params[name]
    if (value === undefined) throw new Error(`Missing path parameter «${name}» for ${path}`)
    return encodeURIComponent(value)
  })
}
