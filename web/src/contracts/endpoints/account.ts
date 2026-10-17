// Sign-in and the account (docs/eng/auth.md).
import { endpoint } from '../endpoint'
import { createdWire } from '../primitives'
import {
  emailStartRequest,
  emailVerifyRequest,
  googleSignInRequest,
  profileUpdateRequest,
  profileWire,
  pushSubscriptionRequest,
  userWire,
} from '../session'

export const getSession = endpoint({
  method: 'GET',
  path: '/session',
  summary: 'Who is signed in. `unauthorized` means nobody, which is an answer and not a fault.',
  auth: 'session',
  response: userWire,
})

export const startEmailCode = endpoint({
  method: 'POST',
  path: '/auth/email/start',
  summary: 'Emails a 6-digit code. Always 204, so the endpoint cannot be used to probe accounts.',
  auth: 'public',
  body: emailStartRequest,
})

export const verifyEmailCode = endpoint({
  method: 'POST',
  path: '/auth/email/verify',
  summary: 'Trades the emailed code for a session; the account is created on its first sign-in.',
  auth: 'public',
  body: emailVerifyRequest,
  response: userWire,
  errors: ['invalid_code'],
})

export const googleSignIn = endpoint({
  method: 'POST',
  path: '/auth/google',
  summary: 'Trades a Google ID token for a session. `unauthorized` when Google rejects the token.',
  auth: 'public',
  body: googleSignInRequest,
  response: userWire,
  errors: ['unauthorized'],
})

export const signOut = endpoint({
  method: 'POST',
  path: '/auth/sign-out',
  summary: 'Ends the session. 204 whether or not there was one.',
  auth: 'public',
})

export const getProfile = endpoint({
  method: 'GET',
  path: '/me/profile',
  summary: 'The account as its owner edits it.',
  auth: 'session',
  response: profileWire,
})

export const updateProfile = endpoint({
  method: 'PATCH',
  path: '/me/profile',
  summary: 'Changes the fields sent and answers the whole profile.',
  auth: 'session',
  body: profileUpdateRequest,
  response: profileWire,
})

export const deleteAccount = endpoint({
  method: 'DELETE',
  path: '/me',
  summary:
    'Deletes the account (the stores require it in-app; decision #28). Its active cases ' +
    'are closed, what it contributed to others’ cases stays anonymous, its interests and offers ' +
    'are withdrawn, its inbox, devices and conversations are erased, and the session ends.',
  auth: 'session',
})

export const registerPush = endpoint({
  method: 'POST',
  path: '/me/push-subscriptions',
  summary: 'Registers this install for push. Registering the same token again is not an error.',
  auth: 'session',
  body: pushSubscriptionRequest,
  status: 201,
  response: createdWire,
})

export const unregisterPush = endpoint({
  method: 'DELETE',
  path: '/me/push-subscriptions/:id',
  summary: 'Stops push to one install.',
  auth: 'session',
  errors: ['not_found'],
})
