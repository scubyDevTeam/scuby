// The in-app chat (docs/eng/comms.md · Twilio Conversations): two registered people per case,
// created at the first message, closed and final when the case ends.
import { api } from '../../contracts/api'
import {
  type CaseRow,
  type ConversationRow,
  db,
  findCase,
  type MessageRow,
  newId,
  type PersonRow,
  person,
  pet,
} from '../db'
import { fail, route } from '../route'
import { iso, lookTitle, ms, publicName, whatsappUrl } from '../rules'

/** The animal as the thread names it: its name, or what it looks like when it has none (found). */
const nameOf = (animal: ReturnType<typeof pet>): string | null =>
  animal ? (animal.name ?? lookTitle(animal)) : null

const resolutionNote = (row: CaseRow): string => {
  const resolution = (row as { resolution?: string | null }).resolution ?? ''
  if (resolution.startsWith('reunited')) return '¡Volvió con su familia!'
  if (resolution.startsWith('adopted')) return 'Encontró hogar'
  if (resolution === 'covered') return 'Ya tiene la ayuda'
  if (resolution === 'converted_to_adoptable') return 'Pasó a adopción'
  return 'Caso cerrado'
}

/** Closed and final when the case is no longer active: the real backend sets it on the resolution. */
function closedOf(conversation: ConversationRow) {
  const row = findCase(conversation.case_code)
  if (row && row.status === 'active') return null
  const at = (row as { resolved_at?: string | null } | undefined)?.resolved_at
  return {
    at: at ?? conversation.created_at,
    note: row ? resolutionNote(row) : 'Caso cerrado',
  }
}

const messagesOf = (conversation: ConversationRow) =>
  db.messages
    .filter((m) => m.conversation_id === conversation.id)
    .sort((a, b) => ms(a.created_at) - ms(b.created_at))

const isUnread = (message: MessageRow, conversation: ConversationRow, personId: string) =>
  message.sender_id !== personId &&
  ms(message.created_at) > ms(conversation.read_at[personId] ?? '1970-01-01T00:00:00Z')

const otherOf = (conversation: ConversationRow, personId: string) =>
  conversation.started_by === personId ? conversation.other_id : conversation.started_by

function mine(id: string, user: PersonRow): ConversationRow {
  const conversation = db.conversations.find((c) => c.id === id) ?? fail('not_found')
  if (conversation.started_by !== user.id && conversation.other_id !== user.id) fail('forbidden')
  return conversation
}

function messageView(message: MessageRow, viewerId: string) {
  return {
    id: message.id,
    kind: message.kind,
    label: message.label,
    body: message.body,
    photo_urls: message.photo_urls,
    phone: message.phone,
    whatsapp_url: message.phone ? whatsappUrl(message.phone) : null,
    mine: message.sender_id === viewerId,
    sent_at: message.created_at,
  }
}

function caseCard(conversation: ConversationRow, row: CaseRow | undefined) {
  const animal = row ? pet(row.pet_id) : null
  return {
    code: conversation.case_code,
    vertical: row?.vertical ?? ('lost' as const),
    pet_name: nameOf(animal),
    photo_url: animal?.photo_urls[0] ?? null,
    summary: '',
  }
}

const sinceText = (timestamp: string) => {
  const minutes = Math.max(1, Math.round((Date.now() - ms(timestamp)) / 60_000))
  if (minutes < 60) return `hace ${minutes} min`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `hace ${hours} h`
  return `hace ${Math.round(hours / 24)} d`
}

function lastLine(message: MessageRow | undefined): string {
  if (!message) return ''
  if (message.kind === 'whatsapp') return 'Te dio su WhatsApp'
  if (message.kind === 'automatic') return message.label ?? message.body
  return message.body
}

/**
 * The thread a claim or an interest opens, born with the server's own first message — the evidence
 * or the introduction the person already gave (comms.md rule 1: created with its first message).
 * One per pair and case: a second claim does not start another.
 */
export function openThread(input: {
  caseCode: string
  startedBy: string
  otherId: string
  topic: string
  label: string
  body: string
  photoUrls?: string[]
}) {
  const exists = db.conversations.some(
    (c) =>
      c.case_code === input.caseCode &&
      [c.started_by, c.other_id].includes(input.startedBy) &&
      [c.started_by, c.other_id].includes(input.otherId),
  )
  if (exists) return
  const createdAt = iso(Date.now())
  const id = newId('conv-')
  db.conversations.push({
    id,
    case_code: input.caseCode,
    started_by: input.startedBy,
    other_id: input.otherId,
    topic: input.topic,
    created_at: createdAt,
    // The one who wrote it has read it; the other has not.
    read_at: { [input.startedBy]: createdAt },
  })
  db.messages.push({
    id: newId('msg-'),
    conversation_id: id,
    sender_id: null,
    kind: 'automatic',
    label: input.label,
    body: input.body,
    photo_urls: input.photoUrls ?? [],
    phone: null,
    created_at: createdAt,
  })
}

export const conversations = [
  route(api.listConversations, ({ user }) => {
    const mineRows = db.conversations.filter(
      (c) => c.started_by === user.id || c.other_id === user.id,
    )
    const items = mineRows.map((conversation) => {
      const messages = messagesOf(conversation)
      const last = messages.at(-1)
      const row = findCase(conversation.case_code)
      const animal = row ? pet(row.pet_id) : null
      const other = person(otherOf(conversation, user.id))
      return {
        id: conversation.id,
        case_code: conversation.case_code,
        other_name: other ? publicName(other.display_name) : 'Alguien',
        photo_url: animal?.photo_urls[0] ?? null,
        topic: `${nameOf(animal) ?? 'Animal'} · ${conversation.topic}`,
        preview: lastLine(last),
        last_at: last?.created_at ?? conversation.created_at,
        unread_count: messages.filter((m) => isUnread(m, conversation, user.id)).length,
        closed: closedOf(conversation) !== null,
      }
    })
    // Open threads first, newest message on top; the closed ones sit below.
    items.sort((a, b) => Number(a.closed) - Number(b.closed) || ms(b.last_at) - ms(a.last_at))
    return { unread_count: items.reduce((n, i) => n + i.unread_count, 0), items }
  }),

  route(api.getConversation, ({ params, user }) => {
    const conversation = mine(params.id, user)
    const row = findCase(conversation.case_code)
    const other = person(otherOf(conversation, user.id))
    const messages = messagesOf(conversation)
    const closed = closedOf(conversation)
    const card = caseCard(conversation, row)
    return {
      id: conversation.id,
      other_name: other ? publicName(other.display_name) : 'Alguien',
      case: {
        ...card,
        summary: `${conversation.topic[0]?.toUpperCase()}${conversation.topic.slice(1)} · ${sinceText(conversation.created_at)}`,
      },
      closed,
      can_share_whatsapp:
        !closed &&
        user.phone !== null &&
        !messages.some((m) => m.kind === 'whatsapp' && m.sender_id === user.id),
      messages: messages.map((m) => messageView(m, user.id)),
    }
  }),

  route(api.sendMessage, ({ params, body, user }) => {
    const conversation = mine(params.id, user)
    if (closedOf(conversation)) fail('invalid_transition')
    const message: MessageRow = {
      id: newId('msg-'),
      conversation_id: conversation.id,
      sender_id: user.id,
      kind: 'text',
      label: null,
      body: body.body.trim(),
      photo_urls: [],
      phone: null,
      created_at: iso(Date.now()),
    }
    db.messages.push(message)
    // Writing is reading: what they wrote before is on screen.
    conversation.read_at[user.id] = message.created_at
    return messageView(message, user.id)
  }),

  route(api.readConversation, ({ params, user }) => {
    mine(params.id, user).read_at[user.id] = iso(Date.now())
    return null
  }),

  route(api.shareWhatsapp, ({ params, user }) => {
    const conversation = mine(params.id, user)
    if (closedOf(conversation)) fail('invalid_transition')
    if (!user.phone) fail('phone_required')
    const shared = db.messages.some(
      (m) =>
        m.conversation_id === conversation.id && m.kind === 'whatsapp' && m.sender_id === user.id,
    )
    if (shared) fail('invalid_transition')
    const message: MessageRow = {
      id: newId('msg-'),
      conversation_id: conversation.id,
      sender_id: user.id,
      kind: 'whatsapp',
      label: null,
      body: '',
      photo_urls: [],
      phone: user.phone,
      created_at: iso(Date.now()),
    }
    db.messages.push(message)
    conversation.read_at[user.id] = message.created_at
    return messageView(message, user.id)
  }),

  route(api.startConversation, ({ params, body, user }) => {
    const row = findCase(params.code) ?? fail('not_found')
    if (!('created_by' in row)) fail('not_found')
    const answers = row.created_by
    if (answers === user.id) fail('forbidden')
    if (row.status !== 'active') fail('invalid_transition')

    let conversation = db.conversations.find(
      (c) =>
        c.case_code === row.code &&
        [c.started_by, c.other_id].includes(user.id) &&
        [c.started_by, c.other_id].includes(answers),
    )
    if (!conversation) {
      conversation = {
        id: newId('conv-'),
        case_code: row.code,
        started_by: user.id,
        other_id: answers,
        topic: row.vertical === 'adoption' ? 'interesado en adoptar' : 'escribió por chat',
        created_at: iso(Date.now()),
        read_at: {},
      }
      db.conversations.push(conversation)
    }
    const message: MessageRow = {
      id: newId('msg-'),
      conversation_id: conversation.id,
      sender_id: user.id,
      kind: 'text',
      label: null,
      body: body.body.trim(),
      photo_urls: [],
      phone: null,
      created_at: iso(Date.now()),
    }
    db.messages.push(message)
    conversation.read_at[user.id] = message.created_at
    return { id: conversation.id }
  }),
]
