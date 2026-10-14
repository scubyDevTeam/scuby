// hand-written until O14 — provisional wire shapes for what a helper sends.
import * as z from 'zod/mini'

export type SightingInput = {
  point: { lat: number; lng: number }
  seenAt: Date
  note: string | null
  /** E.164, or null: contact is optional on a sighting (docs/product/04, decision #13). */
  contactPhone: string | null
}

export const sightingBody = (input: SightingInput) => ({
  point: input.point,
  seen_at: input.seenAt.toISOString(),
  note: input.note,
  contact_phone: input.contactPhone,
})

/** The phone is the whole value of a claim, so it is required (docs/product/04 · recovery_claim). */
export type ClaimInput = { phone: string }

const claimWire = z.object({ id: z.string(), whatsapp_url: z.nullable(z.string()) })

export type ClaimResult = { id: string; whatsappUrl: string | null }

export function parseClaim(raw: unknown): ClaimResult {
  const wire = claimWire.parse(raw)
  return { id: wire.id, whatsappUrl: wire.whatsapp_url }
}

export type ReportInput = {
  targetType: 'lost_case' | 'found_case' | 'adoption_case' | 'help_request'
  targetCode: string
  reason: string
  note: string | null
}

export const reportBody = (input: ReportInput) => ({
  target_type: input.targetType,
  target_code: input.targetCode,
  reason: input.reason,
  note: input.note,
})

export const parseCreated = (raw: unknown) => z.object({ id: z.string() }).parse(raw)
