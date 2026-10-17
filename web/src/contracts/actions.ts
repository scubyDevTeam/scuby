// What a helper sends without an account: a sighting, «lo tengo», a report (docs/product/04, 09).
import * as z from 'zod/mini'
import { createdWire, phone, photoUrl, point, timestamp } from './primitives'

/** Only the pin is required (decision #13). Limits: docs/eng/media-pipeline.md §1. */
export const sightingRequest = z.object({
  point,
  seen_at: timestamp,
  note: z.nullable(z.string().check(z.maxLength(500))),
  photo_urls: z._default(z.array(photoUrl).check(z.maxLength(3)), []),
  contact_phone: z.nullable(phone),
  /**
   * Made by the client once per sighting and sent again on every retry: the same key on the same
   * case answers the sighting it already created (docs/eng/api.md · Conventions, replays).
   */
  client_id: z.optional(z.string().check(z.minLength(8), z.maxLength(64))),
})

export type SightingInput = {
  point: { lat: number; lng: number }
  seenAt: Date
  note: string | null
  photoUrls?: string[]
  /** E.164, or null: contact is optional on a sighting (docs/product/04, decision #13). */
  contactPhone: string | null
  /** The replay key (`client_id`): the queue sends the same one until the server answers. */
  clientId?: string
}

export type SightingBody = z.input<typeof sightingRequest>

export const sightingBody = (input: SightingInput): SightingBody => ({
  point: input.point,
  seen_at: input.seenAt.toISOString(),
  note: input.note,
  photo_urls: input.photoUrls ?? [],
  contact_phone: input.contactPhone,
  ...(input.clientId ? { client_id: input.clientId } : {}),
})

/** «Corregir»: the pin and the time move, no new row (docs/product/04 · Second pin from the same reporter). */
export const sightingCorrectionRequest = z.object({
  point,
  seen_at: timestamp,
  note: z.nullable(z.string().check(z.maxLength(500))),
})

export type SightingCorrection = {
  point: { lat: number; lng: number }
  seenAt: Date
  note: string | null
}

export const sightingCorrectionBody = (
  input: SightingCorrection,
): z.input<typeof sightingCorrectionRequest> => ({
  point: input.point,
  seen_at: input.seenAt.toISOString(),
  note: input.note,
})

/** The phone is the whole value of a claim, so it is required (docs/product/04 · recovery_claim). */
export const recoveryClaimRequest = z.object({
  phone,
  photo_urls: z._default(z.array(photoUrl).check(z.maxLength(5)), []),
  /** The claimant's own sighting on this case, when the claim grew out of it. */
  from_sighting_id: z._default(z.nullable(z.string()), null),
})

export type ClaimInput = { phone: string }

export const recoveryClaimBody = (input: ClaimInput): z.input<typeof recoveryClaimRequest> => ({
  phone: input.phone,
})

/** The row exists before any channel opens; the answer carries the channel to the other side. */
export const claimWire = z.object({ id: z.string(), whatsapp_url: z.nullable(z.string()) })

export type ClaimResult = { id: string; whatsappUrl: string | null }

export function parseClaim(raw: unknown): ClaimResult {
  const wire = claimWire.parse(raw)
  return { id: wire.id, whatsappUrl: wire.whatsapp_url }
}

export const reportTargetSchema = z.enum([
  'lost_case',
  'found_case',
  'adoption_case',
  'help_request',
  'sighting',
  'recovery_claim',
  'ownership_claim',
])

export const reportReasonSchema = z.enum([
  'spam',
  'duplicate',
  'scam_or_extortion',
  'harassment',
  'graphic_content',
  'personal_data',
  'animal_welfare',
  'other',
])

/** Anonymous and one tap: a reason is required, nothing else is (docs/product/09). */
export const reportRequest = z.object({
  target_type: reportTargetSchema,
  /** A case's short code, or the id of a sighting or claim. */
  target_id: z.string().check(z.minLength(1)),
  reason: reportReasonSchema,
  note: z.nullable(z.string().check(z.maxLength(1000))),
})

export type ReportInput = {
  targetType: 'lost_case' | 'found_case' | 'adoption_case' | 'help_request'
  targetCode: string
  reason: z.infer<typeof reportReasonSchema>
  note: string | null
}

export const reportBody = (input: ReportInput): z.input<typeof reportRequest> => ({
  target_type: input.targetType,
  target_id: input.targetCode,
  reason: input.reason,
  note: input.note,
})

export const parseCreated = (raw: unknown) => createdWire.parse(raw)

/** What the upload endpoint answers: the URL to send back in a form. */
export const uploadWire = z.object({ url: photoUrl })
export const parseUpload = (raw: unknown) => uploadWire.parse(raw).url
