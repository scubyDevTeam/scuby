// hand-written until O14 — provisional wire shape.
import { z } from 'zod'

const userWire = z.object({ id: z.string(), display_name: z.string(), email: z.string() })

export type User = { id: string; displayName: string; email: string }

export function parseUser(raw: unknown): User {
  const wire = userWire.parse(raw)
  return { id: wire.id, displayName: wire.display_name, email: wire.email }
}

export const parseNothing = () => null
