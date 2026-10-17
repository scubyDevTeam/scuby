// What a signed-in owner reads and sends: their pets and cases, publishing, and every action on a
// lost case that is theirs (docs/product/04).
import * as z from 'zod/mini'
import {
  type Color,
  colorSchema,
  contactPrefs,
  phone,
  photoUrl,
  point,
  sizeSchema,
  speciesSchema,
  timestamp,
  verticalSchema,
} from './primitives'

// The inbox's shapes live in inbox.ts: the app chrome reads them on every page.
export * from './inbox'

export const petWire = z.object({
  id: z.string(),
  name: z.string(),
  species: speciesSchema,
  size: z.nullable(sizeSchema),
  colors: z.array(colorSchema),
  marks: z.nullable(z.string()),
  photo_urls: z.array(z.string()),
  /** Set while the pet has an active lost case: a second one is blocked (04 · Publishing). */
  active_case_code: z.nullable(z.string()),
  /** An expired case from the last 30 days: offer to reopen it instead of publishing anew. */
  reopenable_case_code: z._default(z.nullable(z.string()), null),
})
export const petsWire = z.array(petWire)

export type Pet = {
  id: string
  name: string
  species: z.infer<typeof speciesSchema>
  size: z.infer<typeof sizeSchema> | null
  colors: Color[]
  marks: string | null
  photoUrls: string[]
  activeCaseCode: string | null
  reopenableCaseCode: string | null
}

export function parsePets(raw: unknown): Pet[] {
  return petsWire.parse(raw).map((pet) => ({
    id: pet.id,
    name: pet.name,
    species: pet.species,
    size: pet.size,
    colors: pet.colors,
    marks: pet.marks,
    photoUrls: pet.photo_urls,
    activeCaseCode: pet.active_case_code,
    reopenableCaseCode: pet.reopenable_case_code,
  }))
}

const myCaseWire = z.object({
  code: z.string(),
  vertical: verticalSchema,
  status: z.string(),
  title: z.string(),
  place_name: z.string(),
  photo_url: z.nullable(z.string()),
  published_at: timestamp,
  open_claim_count: z.int().check(z.nonnegative()),
  /**
   * When the oldest question the caller owes an answer to on this case was asked, or null: home
   * shows it as a banner until it is answered (docs/eng/comms.md · Actionable check-ins).
   */
  pending_checkin_at: z._default(z.nullable(timestamp), null),
})
export const myCasesWire = z.array(myCaseWire)

export type MyCase = {
  code: string
  vertical: z.infer<typeof verticalSchema>
  status: string
  title: string
  placeName: string
  photoUrl: string | null
  publishedAt: Date
  openClaimCount: number
  pendingCheckinAt: Date | null
}

export function parseMyCases(raw: unknown): MyCase[] {
  return myCasesWire.parse(raw).map((item) => ({
    code: item.code,
    vertical: item.vertical,
    status: item.status,
    title: item.title,
    placeName: item.place_name,
    photoUrl: item.photo_url,
    publishedAt: new Date(item.published_at),
    openClaimCount: item.open_claim_count,
    pendingCheckinAt: item.pending_checkin_at ? new Date(item.pending_checkin_at) : null,
  }))
}

/** The phone step every publish form shares (docs/eng/auth.md · UI contract). */
export const publisherPhone = {
  /** E.164, or null to keep the account's verified number. A new number is verified by SMS. */
  phone: z.nullable(phone),
  /** Asserted by a checkbox, not verified (no WABA yet). */
  phone_has_whatsapp: z.boolean(),
  contact_prefs: contactPrefs,
  /** The SMS code, on the second attempt of a publish that answered `phone_step: otp`. */
  otp_code: z.nullable(z.string().check(z.regex(/^\d{6}$/))),
}

/** Publishing writes pet, owner link and case in one transaction (docs/product/04 · Publishing). */
export const publishLostRequest = z.object({
  /** One of the caller's pets, or null to create it from `pet`. */
  pet_id: z.nullable(z.string()),
  pet: z.object({
    name: z.string().check(z.minLength(1), z.maxLength(60)),
    species: speciesSchema,
    size: sizeSchema,
    colors: z.array(colorSchema),
    marks: z.nullable(z.string().check(z.maxLength(500))),
    chip_number: z.nullable(z.string().check(z.maxLength(40))),
    photo_urls: z.array(photoUrl).check(z.maxLength(6)),
  }),
  last_seen_point: point,
  /** The owner's uncertainty, not the broadcast radius. */
  last_seen_radius_m: z.number().check(z.positive(), z.lte(5000)),
  last_seen_at: timestamp,
  ...publisherPhone,
})

export type PublishLostInput = {
  petId: string | null
  name: string
  species: z.infer<typeof speciesSchema>
  size: z.infer<typeof sizeSchema>
  colors: Color[]
  marks: string | null
  chipNumber: string | null
  photoUrls: string[]
  center: { lat: number; lng: number }
  radiusM: number
  lastSeenAt: Date
  /** E.164, or null to keep the account's verified number. */
  phone: string | null
  hasWhatsapp: boolean
  contact: { whatsapp: boolean; email: boolean; inApp: boolean }
  /** The SMS code, on the second attempt of a publish that answered `otp`. */
  otpCode: string | null
}

export const publishLostBody = (input: PublishLostInput): z.input<typeof publishLostRequest> => ({
  pet_id: input.petId,
  pet: {
    name: input.name,
    species: input.species,
    size: input.size,
    colors: input.colors,
    marks: input.marks,
    chip_number: input.chipNumber,
    photo_urls: input.photoUrls,
  },
  last_seen_point: input.center,
  last_seen_radius_m: input.radiusM,
  last_seen_at: input.lastSeenAt.toISOString(),
  phone: input.phone,
  phone_has_whatsapp: input.hasWhatsapp,
  contact_prefs: {
    expose_whatsapp: input.contact.whatsapp,
    expose_email: input.contact.email,
    in_app_only: input.contact.inApp && !input.contact.whatsapp && !input.contact.email,
  },
  otp_code: input.otpCode,
})

/**
 * The server decides whether the number needs its SMS code (frontend.md · Rule 3: the client never
 * reads the flag). `otp` = a code was sent, send it back; `published` = the case is live.
 */
export const publishWire = z.union([
  z.object({ phone_step: z.literal('otp') }),
  z.object({ code: z.string() }),
])

export type PublishResult = { kind: 'otp' } | { kind: 'published'; code: string }

export function parsePublish(raw: unknown): PublishResult {
  const wire = publishWire.parse(raw)
  return 'code' in wire ? { kind: 'published', code: wire.code } : { kind: 'otp' }
}

// The upload answer lives with the helpers' shapes (actions.ts): every form with photos uses it.
export { parseUpload, uploadWire } from './actions'

/** «¿Quién te ayudó?» (docs/product/04 · `resolution` values). */
export const lostAttributionSchema = z.enum([
  'platform_sighting',
  'platform_claim',
  'platform_share',
  'offline',
  'unknown',
])
export const lostCancelReasonSchema = z.enum(['false_alarm', 'duplicate'])
export type LostAttribution = z.infer<typeof lostAttributionSchema>
export type LostCancelReason = z.infer<typeof lostCancelReasonSchema>

export const reuniteRequest = z.object({ resolution_attribution: lostAttributionSchema })
export const cancelRequest = z.object({ resolution: lostCancelReasonSchema })
export const answerClaimRequest = z.object({ status: z.enum(['confirmed', 'dismissed']) })

/** The owner's hand on a pin: star it, or take it off the public map. Send what changes. */
export const moderateSightingRequest = z.object({
  highlighted: z.optional(z.boolean()),
  hidden: z.optional(z.boolean()),
})

/**
 * One answer per check-in (docs/product/04 · The follow-up loop). On a lost case the first three
 * answer a time-based check-in, the next three a claim check-in. On an adoption listing
 * (docs/product/06) `still_available` is the one-tap answer; «ya fue adoptado» and «ya no está
 * disponible» go through their own endpoints, which end the listing and its questions. On a help
 * request (docs/product/07) `still_needed` is «Sigue»; «ya no necesita ayuda» is `closeHelp`.
 */
export const answerCheckinRequest = z.object({
  response: z.enum([
    'still_lost',
    'reunited',
    'delete',
    'claim_confirmed',
    'claim_dismissed',
    'still_verifying',
    'still_available',
    'still_needed',
  ]),
  /** With `reunited`. `claim_confirmed` is always `platform_claim`. */
  resolution_attribution: z._default(z.nullable(lostAttributionSchema), null),
  /** With `delete`. */
  resolution: z._default(z.nullable(lostCancelReasonSchema), null),
})

export type CheckinAnswer = z.infer<typeof answerCheckinRequest>['response']
