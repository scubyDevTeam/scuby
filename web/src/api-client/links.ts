import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as linkEndpoints from '../contracts/endpoints/links'
import { parseCheckinLink } from '../contracts/links'
import { call } from './http'

const linkKey = (token: string) => ['checkin-link', token] as const
/** An answer changed the case, the owner's lists and home's banner — everything but the links. */
const notLinks = (query: { queryKey: readonly unknown[] }) => query.queryKey[0] !== 'checkin-link'

/**
 * What an email button is. Opening it may answer (a safe answer acts on the GET), so it is asked
 * once per visit: never refetched on focus or by staleness — the next read would say `used`.
 */
export function useCheckinLink(token: string) {
  const client = useQueryClient()
  return useQuery({
    queryKey: linkKey(token),
    queryFn: async () => {
      const link = await call(
        linkEndpoints.openCheckinLink,
        { params: { token } },
        parseCheckinLink,
      )
      if (link.state === 'applied') void client.invalidateQueries({ predicate: notLinks })
      return link
    },
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
}

/** The confirm page's one button. What it answers replaces what the link said. */
export function useConfirmCheckinLink(token: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () =>
      call(linkEndpoints.confirmCheckinLink, { params: { token } }, parseCheckinLink),
    onSuccess: (link) => {
      client.setQueryData(linkKey(token), link)
      void client.invalidateQueries({ predicate: notLinks })
    },
  })
}
