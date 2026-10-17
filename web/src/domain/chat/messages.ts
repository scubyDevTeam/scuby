// What a chat message may be and how a thread reads (docs/eng/comms.md · Twilio Conversations).
// The server decides who may write; this only advises what to offer.

/** One message is a short note, not a letter: longer things go in a call or in WhatsApp. */
export const MAX_MESSAGE_LENGTH = 1000

export type MessageProblem = 'empty' | 'too_long'

export function messageProblem(text: string): MessageProblem | null {
  const trimmed = text.trim()
  if (trimmed === '') return 'empty'
  return trimmed.length > MAX_MESSAGE_LENGTH ? 'too_long' : null
}

/** A closed conversation is read-only and final: nothing to type, nothing to give (comms.md rule 4). */
export const canWrite = (conversation: { closed: boolean }): boolean => !conversation.closed

/** «Dar mi WhatsApp» is offered while it can still be said, and once: after sharing it is on the thread. */
export function canShareWhatsapp(conversation: {
  closed: boolean
  canShareWhatsapp: boolean
}): boolean {
  return canWrite(conversation) && conversation.canShareWhatsapp
}

/** The same calendar day, in the viewer's zone: the thread breaks a new «3 de octubre» between days. */
export const isSameDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate()

/** Messages with the days that start them: `showDay` is true on the first one of each day. */
export function withDays<T extends { sentAt: Date }>(
  messages: readonly T[],
): { message: T; showDay: boolean }[] {
  return messages.map((message, i) => {
    const before = messages[i - 1]
    return { message, showDay: !before || !isSameDay(before.sentAt, message.sentAt) }
  })
}
