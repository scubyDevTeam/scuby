// The in-app inbox (docs/product/08). Its own module: the unread count in the app chrome reads it on
// every page, and must not bring the owner's forms along (owner.ts).
import * as z from 'zod/mini'
import { timestamp } from './primitives'

/** A copy of every notification, whatever channel it also went out on (08). */
const notificationWire = z.object({
  id: z.string(),
  /** The domain event that fired it, e.g. `sighting.reported` (docs/product/08). */
  event: z.string(),
  /** Already composed by the server, in Spanish. */
  body: z.string(),
  case_code: z.nullable(z.string()),
  created_at: timestamp,
  read_at: z.nullable(timestamp),
})
export const notificationsWire = z.object({
  unread_count: z.int().check(z.nonnegative()),
  items: z.array(notificationWire),
})
/** Mark these as read, or everything when `ids` is null. */
export const readNotificationsRequest = z.object({ ids: z.nullable(z.array(z.string())) })

export type Notification = {
  id: string
  event: string
  body: string
  caseCode: string | null
  createdAt: Date
  readAt: Date | null
}

export function parseNotifications(raw: unknown): { unreadCount: number; items: Notification[] } {
  const wire = notificationsWire.parse(raw)
  return {
    unreadCount: wire.unread_count,
    items: wire.items.map((item) => ({
      id: item.id,
      event: item.event,
      body: item.body,
      caseCode: item.case_code,
      createdAt: new Date(item.created_at),
      readAt: item.read_at ? new Date(item.read_at) : null,
    })),
  }
}
