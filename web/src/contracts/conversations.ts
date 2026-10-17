// The in-app chat (docs/eng/comms.md · Twilio Conversations): one conversation per case and pair of
// people, created at the first message. Its own module, like the inbox: the list reads it on the
// «Mensajes» tab only.
import * as z from 'zod/mini'
import { photoUrl, timestamp, verticalSchema } from './primitives'

const MAX_BODY = 1000

/** What a message is: a person's text, one the server wrote for the thread, or a shared number. */
export const messageKindSchema = z.enum(['text', 'automatic', 'whatsapp'])

export const messageWire = z.object({
  id: z.string(),
  kind: messageKindSchema,
  /** `automatic` only: the line above it («Mensaje automático · su presentación»), already composed. */
  label: z.nullable(z.string()),
  body: z.string(),
  /** `automatic` only: the evidence that came with it. */
  photo_urls: z.array(photoUrl),
  /** `whatsapp` only: the number shared and its wa.me link. */
  phone: z.nullable(z.string()),
  whatsapp_url: z.nullable(z.string()),
  mine: z.boolean(),
  sent_at: timestamp,
})

/** The case the conversation is about: the card at the top of the thread. */
const conversationCaseWire = z.object({
  code: z.string(),
  vertical: verticalSchema,
  pet_name: z.nullable(z.string()),
  photo_url: z.nullable(photoUrl),
  /** Already composed: «Reclamo «Es mío» · hace 12 min», «Adopción · interesada». */
  summary: z.string(),
})

export const conversationWire = z.object({
  id: z.string(),
  other_name: z.string(),
  case: conversationCaseWire,
  /** Set when the case ended: the thread stays readable and nothing more is sent (rule 4). */
  closed: z.nullable(z.object({ at: timestamp, note: z.string() })),
  /** False once this person gave their WhatsApp in the thread (or has none verified to give). */
  can_share_whatsapp: z.boolean(),
  messages: z.array(messageWire),
})

const conversationItemWire = z.object({
  id: z.string(),
  case_code: z.string(),
  other_name: z.string(),
  photo_url: z.nullable(photoUrl),
  /** «Gatito negro · reclamo «Es mío»»: the case and why they wrote, composed by the server. */
  topic: z.string(),
  /** The last message, trimmed, or the server's line for an automatic one. */
  preview: z.string(),
  last_at: timestamp,
  unread_count: z.int().check(z.nonnegative()),
  closed: z.boolean(),
})

export const conversationsWire = z.object({
  /** Messages waiting across every conversation. */
  unread_count: z.int().check(z.nonnegative()),
  items: z.array(conversationItemWire),
})

export const sendMessageRequest = z.object({
  body: z.string().check(z.minLength(1), z.maxLength(MAX_BODY)),
})

/** The first message of a conversation: it is created with it, never on intent (comms.md rule 1). */
export const startConversationRequest = sendMessageRequest

export const startedConversationWire = z.object({ id: z.string() })

export type ChatMessage = {
  id: string
  kind: 'text' | 'automatic' | 'whatsapp'
  label: string | null
  body: string
  photoUrls: string[]
  phone: string | null
  whatsappUrl: string | null
  mine: boolean
  sentAt: Date
}

export type Conversation = {
  id: string
  otherName: string
  case: {
    code: string
    vertical: z.infer<typeof verticalSchema>
    petName: string | null
    photoUrl: string | null
    summary: string
  }
  closed: { at: Date; note: string } | null
  canShareWhatsapp: boolean
  messages: ChatMessage[]
}

export type ConversationItem = {
  id: string
  caseCode: string
  otherName: string
  photoUrl: string | null
  topic: string
  preview: string
  lastAt: Date
  unreadCount: number
  closed: boolean
}

export function parseMessage(raw: unknown): ChatMessage {
  const wire = messageWire.parse(raw)
  return {
    id: wire.id,
    kind: wire.kind,
    label: wire.label,
    body: wire.body,
    photoUrls: wire.photo_urls,
    phone: wire.phone,
    whatsappUrl: wire.whatsapp_url,
    mine: wire.mine,
    sentAt: new Date(wire.sent_at),
  }
}

export function parseConversation(raw: unknown): Conversation {
  const wire = conversationWire.parse(raw)
  return {
    id: wire.id,
    otherName: wire.other_name,
    case: {
      code: wire.case.code,
      vertical: wire.case.vertical,
      petName: wire.case.pet_name,
      photoUrl: wire.case.photo_url,
      summary: wire.case.summary,
    },
    closed: wire.closed ? { at: new Date(wire.closed.at), note: wire.closed.note } : null,
    canShareWhatsapp: wire.can_share_whatsapp,
    messages: wire.messages.map((m) => parseMessage(m)),
  }
}

export function parseConversations(raw: unknown): {
  unreadCount: number
  items: ConversationItem[]
} {
  const wire = conversationsWire.parse(raw)
  return {
    unreadCount: wire.unread_count,
    items: wire.items.map((item) => ({
      id: item.id,
      caseCode: item.case_code,
      otherName: item.other_name,
      photoUrl: item.photo_url,
      topic: item.topic,
      preview: item.preview,
      lastAt: new Date(item.last_at),
      unreadCount: item.unread_count,
      closed: item.closed,
    })),
  }
}

export const parseStarted = (raw: unknown): { id: string } => startedConversationWire.parse(raw)
