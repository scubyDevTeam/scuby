// hand-written until O14 — provisional wire shape.
import { z } from 'zod'

const userWire = z.object({
  id: z.string(),
  display_name: z.string(),
  email: z.string(),
  /** The publisher's verified number, E.164. Null until a first publish verifies one. */
  phone: z.string().nullable(),
})

export type User = { id: string; displayName: string; email: string; phone: string | null }

export function parseUser(raw: unknown): User {
  const wire = userWire.parse(raw)
  return { id: wire.id, displayName: wire.display_name, email: wire.email, phone: wire.phone }
}

export const parseNothing = () => null
