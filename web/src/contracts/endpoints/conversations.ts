// The in-app chat (docs/eng/comms.md · Twilio Conversations). Two registered people per case.
import {
  conversationsWire,
  conversationWire,
  messageWire,
  sendMessageRequest,
  startConversationRequest,
  startedConversationWire,
} from '../conversations'
import { endpoint } from '../endpoint'

export const listConversations = endpoint({
  method: 'GET',
  path: '/me/conversations',
  summary:
    'The «Mensajes» tab: this account’s conversations, newest message first, closed ones last. ' +
    'Names come as the other person shows them (first name and initial); never a number.',
  auth: 'session',
  response: conversationsWire,
})

export const getConversation = endpoint({
  method: 'GET',
  path: '/conversations/:id',
  summary:
    'One thread with its messages, oldest first, and the case card. Only its two participants.',
  auth: 'session',
  response: conversationWire,
  errors: ['not_found', 'forbidden'],
})

export const sendMessage = endpoint({
  method: 'POST',
  path: '/conversations/:id/messages',
  summary:
    'A text message. A closed conversation is read-only and final: `invalid_transition`. The ' +
    'other side gets a push, never the text of a number.',
  auth: 'session',
  body: sendMessageRequest,
  status: 201,
  response: messageWire,
  errors: ['not_found', 'forbidden', 'invalid_transition'],
})

export const readConversation = endpoint({
  method: 'POST',
  path: '/conversations/:id/read',
  summary: 'Marks what the other person wrote as read: opening the thread does it.',
  auth: 'session',
  errors: ['not_found', 'forbidden'],
})

export const shareWhatsapp = endpoint({
  method: 'POST',
  path: '/conversations/:id/whatsapp',
  summary:
    '«Dar mi WhatsApp»: puts this account’s verified number on the thread, once, as a message the ' +
    'other side can open. An account without a verified number answers `phone_required`.',
  auth: 'session',
  status: 201,
  response: messageWire,
  errors: ['not_found', 'forbidden', 'invalid_transition', 'phone_required'],
})

export const startConversation = endpoint({
  method: 'POST',
  path: '/cases/:code/conversations',
  summary:
    '«Escribir por chat»: writes the first message to whoever answers for the case — its ' +
    'publisher, custodian or lister — and creates the conversation with it, never on intent. ' +
    'Answers the existing one when the pair already has a thread on the case. Not on your own ' +
    'case; not on a case that ended.',
  auth: 'session',
  body: startConversationRequest,
  status: 201,
  response: startedConversationWire,
  errors: ['not_found', 'forbidden', 'invalid_transition'],
})
