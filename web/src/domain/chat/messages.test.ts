import { describe, expect, it } from 'vitest'
import {
  canShareWhatsapp,
  canWrite,
  MAX_MESSAGE_LENGTH,
  messageProblem,
  withDays,
} from './messages'

describe('messageProblem — what a message may be (comms.md · Twilio Conversations)', () => {
  it('refuses blank text and text past the limit, accepts the rest', () => {
    expect(messageProblem('   ')).toBe('empty')
    expect(messageProblem('a'.repeat(MAX_MESSAGE_LENGTH + 1))).toBe('too_long')
    expect(messageProblem('a'.repeat(MAX_MESSAGE_LENGTH))).toBeNull()
    expect(messageProblem(' Hola ')).toBeNull()
  })
})

describe('a closed conversation is read-only and final (comms.md rule 4)', () => {
  it('offers neither writing nor giving a WhatsApp', () => {
    expect(canWrite({ closed: true })).toBe(false)
    expect(canShareWhatsapp({ closed: true, canShareWhatsapp: true })).toBe(false)
  })

  it('offers «Dar mi WhatsApp» only while the server says it can still be said', () => {
    expect(canShareWhatsapp({ closed: false, canShareWhatsapp: true })).toBe(true)
    expect(canShareWhatsapp({ closed: false, canShareWhatsapp: false })).toBe(false)
  })
})

describe('withDays — a new day line between days', () => {
  it('marks the first message of each day', () => {
    const at = (d: number, h: number) => ({ sentAt: new Date(2026, 9, d, h) })
    const days = withDays([at(3, 9), at(3, 18), at(4, 8)])
    expect(days.map((d) => d.showDay)).toEqual([true, false, true])
  })
})
