// A found case and what its custodian and claimants do with it (docs/product/05).
import * as z from 'zod/mini'
import { publisherPhone } from './owner'
import {
  type Color,
  colorSchema,
  phone,
  photoUrl,
  point,
  sizeSchema,
  speciesSchema,
  timestamp,
} from './primitives'

export const foundStatusSchema = z.enum([
  'active',
  'reunited',
  'kept',
  'converted',
  'transferred_to_org',
  'expired',
  'cancelled',
])
export const holdingWhereSchema = z.enum(['home', 'vet', 'street_temporary', 'no_longer_held'])

const ownershipClaimWire = z.object({
  id: z.string(),
  claimant_name: z.string(),
  created_at: timestamp,
  status: z.enum(['open', 'confirmed', 'dismissed', 'withdrawn', 'stale']),
  evidence_notes: z.nullable(z.string()),
  chip_number: z.nullable(z.string()),
  photo_count: z.int().check(z.nonnegative()),
  /** The claimant's own lost case, when it was published before this found case. */
  from_lost_case_code: z.nullable(z.string()),
  whatsapp_url: z.nullable(z.string()),
})

export const foundCaseWire = z.object({
  code: z.string(),
  vertical: z.literal('found'),
  status: foundStatusSchema,
  resolved_at: z.nullable(timestamp),
  viewer: z.enum(['custodian', 'public']),
  pet: z.object({
    species: speciesSchema,
    size: z.nullable(sizeSchema),
    colors: z.array(colorSchema),
    marks: z.nullable(z.string()),
    photo_urls: z.array(z.string()),
  }),
  found: z.object({
    center: point,
    radius_m: z.number().check(z.positive()),
    at: timestamp,
    place_name: z.string(),
  }),
  holding_where: holdingWhereSchema,
  held_since: timestamp,
  /** When the hold clock next offers a way out: held_since + 15 d, re-armed by «sigo buscando». */
  hold_offer_at: timestamp,
  open_claim_count: z.int().check(z.nonnegative()),
  /** The custodian's own secret, and the claims on the animal: sent to the custodian only. */
  withheld_detail: z._default(z.nullable(z.string()), null),
  ownership_claims: z._default(z.array(ownershipClaimWire), []),
  contact: z.nullable(z.object({ display_name: z.string(), whatsapp_url: z.nullable(z.string()) })),
})

export type OwnershipClaim = {
  id: string
  claimantName: string
  createdAt: Date
  status: 'open' | 'confirmed' | 'dismissed' | 'withdrawn' | 'stale'
  evidenceNotes: string | null
  chipNumber: string | null
  photoCount: number
  fromLostCaseCode: string | null
  whatsappUrl: string | null
}

export type FoundCase = {
  code: string
  vertical: 'found'
  status: z.infer<typeof foundStatusSchema>
  resolvedAt: Date | null
  viewer: 'custodian' | 'public'
  pet: {
    species: 'dog' | 'cat' | 'other'
    size: 'small' | 'medium' | 'large' | null
    colors: Color[]
    marks: string | null
    photoUrls: string[]
  }
  found: { center: { lat: number; lng: number }; radiusM: number; at: Date; placeName: string }
  holdingWhere: z.infer<typeof holdingWhereSchema>
  heldSince: Date
  holdOfferAt: Date
  openClaimCount: number
  withheldDetail: string | null
  ownershipClaims: OwnershipClaim[]
  contact: { displayName: string; whatsappUrl: string | null } | null
}

export function toFoundCase(wire: z.infer<typeof foundCaseWire>): FoundCase {
  return {
    code: wire.code,
    vertical: 'found',
    status: wire.status,
    resolvedAt: wire.resolved_at ? new Date(wire.resolved_at) : null,
    viewer: wire.viewer,
    pet: {
      species: wire.pet.species,
      size: wire.pet.size,
      colors: wire.pet.colors,
      marks: wire.pet.marks,
      photoUrls: wire.pet.photo_urls,
    },
    found: {
      center: wire.found.center,
      radiusM: wire.found.radius_m,
      at: new Date(wire.found.at),
      placeName: wire.found.place_name,
    },
    holdingWhere: wire.holding_where,
    heldSince: new Date(wire.held_since),
    holdOfferAt: new Date(wire.hold_offer_at),
    openClaimCount: wire.open_claim_count,
    withheldDetail: wire.withheld_detail,
    ownershipClaims: wire.ownership_claims.map((claim) => ({
      id: claim.id,
      claimantName: claim.claimant_name,
      createdAt: new Date(claim.created_at),
      status: claim.status,
      evidenceNotes: claim.evidence_notes,
      chipNumber: claim.chip_number,
      photoCount: claim.photo_count,
      fromLostCaseCode: claim.from_lost_case_code,
      whatsappUrl: claim.whatsapp_url,
    })),
    contact: wire.contact && {
      displayName: wire.contact.display_name,
      whatsappUrl: wire.contact.whatsapp_url,
    },
  }
}

/** «Es mío»: everything optional — proof is offered, never required. */
export type OwnershipClaimInput = { evidenceNotes: string | null; chipNumber: string | null }

export const ownershipClaimRequest = z.object({
  evidence_notes: z.nullable(z.string().check(z.maxLength(1000))),
  chip_number: z.nullable(z.string().check(z.maxLength(40))),
  photo_urls: z._default(z.array(photoUrl).check(z.maxLength(5)), []),
})

export const ownershipClaimBody = (
  input: OwnershipClaimInput,
): z.input<typeof ownershipClaimRequest> => ({
  evidence_notes: input.evidenceNotes,
  chip_number: input.chipNumber,
})

/** How a custodian ends a found case. */
export type ResolveInput =
  | { outcome: 'reunited'; attribution: z.infer<typeof foundAttributionSchema> }
  | { outcome: 'kept' }
  | { outcome: 'transferred_to_org'; orgName: string | null }
  | { outcome: 'cancelled'; reason: z.infer<typeof foundCancelReasonSchema> }
  /** Not an ending: «sigo buscando al dueño» re-arms the hold clock. */
  | { outcome: 'keep_searching' }

export const foundAttributionSchema = z.enum([
  'platform_claim',
  'platform_match',
  'platform_share',
  'offline',
  'unknown',
])
export const foundCancelReasonSchema = z.enum(['not_a_stray', 'ran_off_again', 'duplicate'])

/** `keep_searching` is not an ending: it re-arms the hold clock for another 15 days. */
export const resolveFoundRequest = z.object({
  outcome: z.enum(['reunited', 'kept', 'transferred_to_org', 'cancelled', 'keep_searching']),
  /** With `reunited`. */
  resolution_attribution: z.nullable(foundAttributionSchema),
  /** With `transferred_to_org`: a declared outcome, free text (docs/product/05). */
  org_name: z.nullable(z.string().check(z.maxLength(120))),
  /** With `cancelled`. */
  resolution: z.nullable(foundCancelReasonSchema),
})

export function resolveBody(input: ResolveInput): z.input<typeof resolveFoundRequest> {
  return {
    outcome: input.outcome,
    resolution_attribution: input.outcome === 'reunited' ? input.attribution : null,
    org_name: input.outcome === 'transferred_to_org' ? input.orgName : null,
    resolution: input.outcome === 'cancelled' ? input.reason : null,
  }
}

/** What matching is asked with (docs/product/05 · Matching). */
export type MatchInput = {
  species: 'dog' | 'cat' | 'other'
  size: 'small' | 'medium' | 'large' | null
  colors: Color[]
  point: { lat: number; lng: number }
  at: Date
}

export const matchRequest = z.object({
  species: speciesSchema,
  size: z.nullable(sizeSchema),
  colors: z.array(colorSchema),
  point,
  at: timestamp,
})

export const matchBody = (input: MatchInput): z.input<typeof matchRequest> => ({
  species: input.species,
  size: input.size,
  colors: input.colors,
  point: input.point,
  at: input.at.toISOString(),
})

export const candidatesWire = z.object({
  candidates: z.array(
    z.object({
      code: z.string(),
      name: z.string(),
      photo_url: z.nullable(z.string()),
      /** Human-readable reasons, so the confirmation explains itself. */
      why: z.array(z.string()),
    }),
  ),
})

export type Candidate = { code: string; name: string; photoUrl: string | null; why: string[] }

export function parseCandidates(raw: unknown): Candidate[] {
  return candidatesWire.parse(raw).candidates.map((candidate) => ({
    code: candidate.code,
    name: candidate.name,
    photoUrl: candidate.photo_url,
    why: candidate.why,
  }))
}

export type PublishFoundInput = {
  species: 'dog' | 'cat' | 'other'
  size: 'small' | 'medium' | 'large'
  colors: Color[]
  marks: string | null
  photoUrls: string[]
  center: { lat: number; lng: number }
  radiusM: number
  foundAt: Date
  holdingWhere: 'home' | 'vet' | 'street_temporary'
  withheldDetail: string | null
  phone: string | null
  hasWhatsapp: boolean
  contact: { whatsapp: boolean; email: boolean; inApp: boolean }
  otpCode: string | null
}

/** A found animal has no name: its `pet` row is unclaimed until someone proves it is theirs. */
export const publishFoundRequest = z.object({
  pet: z.object({
    species: speciesSchema,
    size: sizeSchema,
    colors: z.array(colorSchema),
    marks: z.nullable(z.string().check(z.maxLength(500))),
    photo_urls: z.array(photoUrl).check(z.maxLength(6)),
  }),
  found_point: point,
  found_radius_m: z.number().check(z.positive(), z.lte(5000)),
  found_at: timestamp,
  holding_where: z.enum(['home', 'vet', 'street_temporary']),
  /** The custodian's secret: what a real owner would know and the photos do not show. */
  withheld_detail: z.nullable(z.string().check(z.maxLength(300))),
  ...publisherPhone,
})

export const publishFoundBody = (
  input: PublishFoundInput,
): z.input<typeof publishFoundRequest> => ({
  pet: {
    species: input.species,
    size: input.size,
    colors: input.colors,
    marks: input.marks,
    photo_urls: input.photoUrls,
  },
  found_point: input.center,
  found_radius_m: input.radiusM,
  found_at: input.foundAt.toISOString(),
  holding_where: input.holdingWhere,
  withheld_detail: input.withheldDetail,
  phone: input.phone,
  phone_has_whatsapp: input.hasWhatsapp,
  contact_prefs: {
    expose_whatsapp: input.contact.whatsapp,
    expose_email: input.contact.email,
    in_app_only: input.contact.inApp && !input.contact.whatsapp && !input.contact.email,
  },
  otp_code: input.otpCode,
})

/** A sighting with no case to attach to: kept internally and matched against later lost cases. */
export type OrphanSightingInput = {
  species: 'dog' | 'cat' | 'other'
  photoUrls: string[]
  point: { lat: number; lng: number }
  seenAt: Date
  note: string | null
  contactPhone: string | null
}

export const orphanSightingRequest = z.object({
  species: speciesSchema,
  photo_urls: z.array(photoUrl).check(z.maxLength(3)),
  point,
  seen_at: timestamp,
  note: z.nullable(z.string().check(z.maxLength(500))),
  contact_phone: z.nullable(phone),
})

export const orphanSightingBody = (
  input: OrphanSightingInput,
): z.input<typeof orphanSightingRequest> => ({
  species: input.species,
  photo_urls: input.photoUrls,
  point: input.point,
  seen_at: input.seenAt.toISOString(),
  note: input.note,
  contact_phone: input.contactPhone,
})
