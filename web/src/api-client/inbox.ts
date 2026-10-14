// The inbox (docs/product/08). Its own module: the unread count in the app chrome asks for it on every
// page, and must not bring the owner's forms along.
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as inboxEndpoints from '../contracts/endpoints/inbox'
import { parseNotifications } from '../contracts/inbox'
import { parseNothing } from '../contracts/session'
import { call } from './http'

export const notificationsQuery = queryOptions({
  queryKey: ['me', 'notifications'],
  queryFn: () => call(inboxEndpoints.listNotifications, {}, parseNotifications),
})

export const useNotifications = () => useQuery(notificationsQuery)

/** The ones named, or all of them. */
export function useReadNotifications() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (ids: string[] | null) =>
      call(inboxEndpoints.readNotifications, { body: { ids } }, parseNothing),
    onSuccess: () => client.invalidateQueries({ queryKey: ['me', 'notifications'] }),
  })
}
