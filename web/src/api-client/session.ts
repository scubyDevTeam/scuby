import {
  type QueryClient,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { parseCreated } from '../contracts/actions'
import { api } from '../contracts/api'
import {
  type ProfileUpdate,
  parseNothing,
  parseProfile,
  parseUser,
  profileUpdateBody,
  type User,
} from '../contracts/session'
import { ApiError, call } from './http'

const SESSION = ['session'] as const
const PROFILE = ['me', 'profile'] as const

/** Who is signed in, or null. «Not signed in» is an answer, not an error. */
export const sessionQuery = queryOptions<User | null>({
  queryKey: SESSION,
  queryFn: async () => {
    try {
      return await call(api.getSession, {}, parseUser)
    } catch (error) {
      if (error instanceof ApiError && error.kind === 'unauthorized') return null
      throw error
    }
  },
  staleTime: 5 * 60_000,
})

export function useSession() {
  return useQuery(sessionQuery)
}

/**
 * A «who is signed in?» still in flight was asked before this sign-in: its «nobody» must not land
 * after the answer that says somebody.
 */
async function signedIn(client: QueryClient, user: User) {
  await client.cancelQueries({ queryKey: SESSION })
  client.setQueryData(SESSION, user)
}

/** Emails the 6-digit code. */
export function useStartEmailCode() {
  return useMutation({
    mutationFn: (email: string) => call(api.startEmailCode, { body: { email } }, parseNothing),
  })
}

export function useVerifyEmailCode() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (body: { email: string; code: string }) =>
      call(api.verifyEmailCode, { body }, parseUser),
    onSuccess: (user) => signedIn(client, user),
  })
}

export function useGoogleSignIn() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (body: { credential: string }) => call(api.googleSignIn, { body }, parseUser),
    onSuccess: (user) => signedIn(client, user),
  })
}

export function useSignOut() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () => call(api.signOut, {}, parseNothing),
    // What was fetched as that person must not outlive the session: their lists go, and every
    // case is asked for again — the same URL answers less to a stranger.
    onSuccess: () => {
      client.setQueryData(SESSION, null)
      client.removeQueries({ queryKey: ['me'] })
      client.invalidateQueries({ queryKey: ['case'] })
    },
  })
}

export const profileQuery = queryOptions({
  queryKey: PROFILE,
  queryFn: () => call(api.getProfile, {}, parseProfile),
})

export const useProfile = () => useQuery(profileQuery)

/** The display name also lives on the session, so that is fetched again. */
export function useUpdateProfile() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: ProfileUpdate) =>
      call(api.updateProfile, { body: profileUpdateBody(input) }, parseProfile),
    onSuccess: (profile) => {
      client.setQueryData(PROFILE, profile)
      client.invalidateQueries({ queryKey: SESSION })
    },
  })
}

/** Registers this install for push (docs/eng/frontend.md · Push). */
export function useRegisterPush() {
  return useMutation({
    mutationFn: (input: {
      kind: 'webpush' | 'fcm' | 'apns'
      token: string
      device: string | null
    }) => call(api.registerPush, { body: input }, parseCreated),
  })
}
