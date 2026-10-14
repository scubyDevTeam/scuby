// What a push carries and what the notification does with it. No service-worker globals here, so it
// is plain to test; sw.ts wires it to the events.
//
// The words come from the payload: the backend composes them in the account's language
// (docs/eng/api.md · Accept-Language, O17), never from the language files.
import { answerCheckinRequest } from '@contracts/owner'
import * as z from 'zod/mini'

/**
 * The Web Push payload. Not in the API contract yet (it is not a request): this is the shape the
 * client reads, to be agreed with the backend.
 */
const pushPayload = z.object({
  title: z.string(),
  body: z.string(),
  /** Where a tap leads: a path on this site, the case page with the account's language (`/en/c/7K3PQ`). */
  url: z.string().check(z.regex(/^\/(?![/\\])/)),
  /** Same tag replaces the earlier notification: the backend's coalescing (08). */
  tag: z._default(z.nullable(z.string()), null),
  /** A check-in answered from the notification (docs/eng/comms.md · Actionable check-ins). */
  checkin: z._default(
    z.nullable(
      z.object({
        code: z.string(),
        id: z.string(),
        actions: z.array(
          z.object({ response: answerCheckinRequest.shape.response, title: z.string() }),
        ),
      }),
    ),
    null,
  ),
})

export type PushPayload = z.infer<typeof pushPayload>
type Checkin = NonNullable<PushPayload['checkin']>
export type CheckinResponse = Checkin['actions'][number]['response']

/** What the notification keeps until it is tapped. */
export type NotificationData = { url: string; checkin: Checkin | null }

/** `actions` is in every browser that has buttons, but not in TypeScript's lib yet. */
export type NotificationWithActions = NotificationOptions & {
  data: NotificationData
  actions: { action: string; title: string }[]
}

export function parsePayload(raw: unknown): PushPayload | null {
  const parsed = z.safeParse(pushPayload, raw)
  return parsed.success ? parsed.data : null
}

export function notificationFor(payload: PushPayload, icon: string): NotificationWithActions {
  return {
    body: payload.body,
    icon,
    ...(payload.tag ? { tag: payload.tag } : {}),
    data: { url: payload.url, checkin: payload.checkin },
    // Android shows the buttons and a tap answers without opening the app; where there are no
    // buttons (iOS), the tap opens the case and its check-in banner (comms.md).
    actions: (payload.checkin?.actions ?? []).map((a) => ({ action: a.response, title: a.title })),
  }
}

/**
 * The answer a tapped button stands for: one of the buttons this notification offered, or none
 * (a tap on the body, which opens the case).
 */
export function answerFor(data: NotificationData, action: string) {
  const offered = data.checkin?.actions.find((a) => a.response === action)
  return data.checkin && offered
    ? { code: data.checkin.code, checkinId: data.checkin.id, response: offered.response }
    : null
}
