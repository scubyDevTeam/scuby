// The in-app chat (docs/eng/comms.md · Twilio Conversations): the «Mensajes» tab, one thread, and
// the first message from a case. Its own module — the list and the thread load with their screens.
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  parseConversation,
  parseConversations,
  parseMessage,
  parseStarted,
} from '../contracts/conversations'
import * as conversationEndpoints from '../contracts/endpoints/conversations'
import { parseNothing } from '../contracts/session'
import { call } from './http'

const LIST = ['me', 'conversations'] as const
const thread = (id: string) => ['conversation', id] as const

export const conversationsQuery = queryOptions({
  queryKey: LIST,
  queryFn: () => call(conversationEndpoints.listConversations, {}, parseConversations),
})

export const useConversations = () => useQuery(conversationsQuery)

export const useConversation = (id: string) =>
  useQuery({
    queryKey: thread(id),
    queryFn: () =>
      call(conversationEndpoints.getConversation, { params: { id } }, parseConversation),
    // A thread is a conversation: it is looked at again while it is open, not only when asked.
    refetchInterval: 15_000,
  })

/** Both the thread and the list change with anything said in it. */
function useRefresh(id: string) {
  const client = useQueryClient()
  return () =>
    Promise.all([
      client.invalidateQueries({ queryKey: thread(id) }),
      client.invalidateQueries({ queryKey: LIST }),
    ])
}

export function useSendMessage(id: string) {
  const refresh = useRefresh(id)
  return useMutation({
    mutationFn: (body: string) =>
      call(conversationEndpoints.sendMessage, { params: { id }, body: { body } }, parseMessage),
    onSuccess: refresh,
  })
}

/** Opening a thread reads it. */
export function useReadConversation(id: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () =>
      call(conversationEndpoints.readConversation, { params: { id } }, parseNothing),
    onSuccess: () => client.invalidateQueries({ queryKey: LIST }),
  })
}

export function useShareWhatsapp(id: string) {
  const refresh = useRefresh(id)
  return useMutation({
    mutationFn: () => call(conversationEndpoints.shareWhatsapp, { params: { id } }, parseMessage),
    onSuccess: refresh,
  })
}

/** «Escribir por chat» from a case: the thread is born with this first message. */
export function useStartConversation(code: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (body: string) =>
      call(
        conversationEndpoints.startConversation,
        { params: { code }, body: { body } },
        parseStarted,
      ),
    onSuccess: () => client.invalidateQueries({ queryKey: LIST }),
  })
}
