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
/**
 * `share.opened` (docs/product/10 §5): someone opened a way to share a case — intent, not outcome.
 * The only evidence a share happened; it keeps `platform_share` attributions honest.
 */
export const shareOpenedRequest = z.object({
  channel: z.enum(['system', 'whatsapp', 'download']),
  format: z.enum(['square', 'story', 'print', 'text']),
})

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

/**
 * What a photo is for. The slot is scoped to it and to who asks (session or device), so a photo
 * cannot be attached to a row of another kind or by another person (docs/eng/media-pipeline.md §1).
 * Limits per purpose: pet 6, sighting 3, claim 5, evidence 5, profile 1.
 */
export const uploadPurposeSchema = z.enum(['pet', 'sighting', 'claim', 'evidence', 'profile'])

/** Asks for one upload slot: the photo as the device prepared it, declared before it is sent. */
export const uploadRequest = z.object({
  purpose: uploadPurposeSchema,
  /** Lowercase hex of the bytes. The slot is signed with it, so storage refuses any other bytes. */
  sha256: z.string().check(z.regex(/^[0-9a-f]{64}$/)),
  content_type: z.literal('image/jpeg'),
  bytes: z.int().check(z.positive(), z.maximum(10_000_000)),
})

/**
 * `url` is where the photo will be, derived from its hash: it goes in the publish body as is.
 * `upload` is where to send the bytes, or null when this exact photo is already stored.
 */
export const uploadWire = z.object({
  url: photoUrl,
  upload: z.nullable(
    z.object({
      method: z.literal('PUT'),
      url: z.string().check(z.minLength(1)),
      /** To send with the bytes, as given (the checksum header among them). */
      headers: z.record(z.string(), z.string()),
      expires_at: timestamp,
    }),
  ),
})

export type UploadPurpose = z.infer<typeof uploadPurposeSchema>
export type UploadInput = { purpose: UploadPurpose; sha256: string; bytes: number }

export const uploadBody = (input: UploadInput): z.input<typeof uploadRequest> => ({
  purpose: input.purpose,
  sha256: input.sha256,
  content_type: 'image/jpeg',
  bytes: input.bytes,
})

export const parseUpload = (raw: unknown) => {
  const wire = uploadWire.parse(raw)
  return {
    url: wire.url,
    target: wire.upload
      ? { url: wire.upload.url, headers: wire.upload.headers, expiresAt: wire.upload.expires_at }
      : null,
  }
}
