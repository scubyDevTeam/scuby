import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { parseNothing, parseUser, type User } from '../contracts/session'
import { ApiError, apiGet, apiPost } from './http'

const SESSION = ['session'] as const

/** Who is signed in, or null. «Not signed in» is an answer, not an error. */
export const sessionQuery = queryOptions<User | null>({
  queryKey: SESSION,
  queryFn: async () => {
    try {
      return await apiGet('/session', parseUser)
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

/** Emails the 6-digit code. */
export function useStartEmailCode() {
  return useMutation({
    mutationFn: (email: string) => apiPost('/auth/email/start', { email }, parseNothing),
  })
}

function useSignInWith<T>(path: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (body: T) => apiPost(path, body, parseUser),
    onSuccess: (user) => client.setQueryData(SESSION, user),
  })
}

export const useVerifyEmailCode = () =>
  useSignInWith<{ email: string; code: string }>('/auth/email/verify')

export const useGoogleSignIn = () => useSignInWith<{ credential: string }>('/auth/google')

export function useSignOut() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () => apiPost('/auth/sign-out', {}, parseNothing),
    onSuccess: () => client.setQueryData(SESSION, null),
  })
}
