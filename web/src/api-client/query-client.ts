import { QueryClient } from '@tanstack/react-query'
import { ApiError } from './http'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // A missing or purged case will not appear by asking again.
      retry: (failureCount, error) =>
        error instanceof ApiError && error.kind === 'network' && failureCount < 2,
    },
  },
})
