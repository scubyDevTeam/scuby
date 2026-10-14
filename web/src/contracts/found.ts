// hand-written until O14 — provisional wire shape of a found case (docs/product/05).
import * as z from 'zod/mini'

const point = z.object({ lat: z.number(), lng: z.number() })
const timestamp = z.iso.datetime({ offset: true })

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
    species: z.enum(['dog', 'cat', 'other']),
    size: z.nullable(z.enum(['small', 'medium', 'large'])),
    colors: z.array(z.string()),
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
    colors: string[]
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

export const ownershipClaimBody = (input: OwnershipClaimInput) => ({
  evidence_notes: input.evidenceNotes,
  chip_number: input.chipNumber,
})

/** How a custodian ends a found case. */
export type ResolveInput =
  | { outcome: 'reunited'; attribution: string }
  | { outcome: 'kept' }
  | { outcome: 'transferred_to_org'; orgName: string | null }
  | { outcome: 'cancelled'; reason: string }
  /** Not an ending: «sigo buscando al dueño» re-arms the hold clock. */
  | { outcome: 'keep_searching' }

export function resolveBody(input: ResolveInput) {
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
  colors: string[]
  point: { lat: number; lng: number }
  at: Date
}

export const matchBody = (input: MatchInput) => ({
  species: input.species,
  size: input.size,
  colors: input.colors,
  point: input.point,
  at: input.at.toISOString(),
})

const candidatesWire = z.object({
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
  colors: string[]
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

export const publishFoundBody = (input: PublishFoundInput) => ({
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

export const orphanSightingBody = (input: OrphanSightingInput) => ({
  species: input.species,
  photo_urls: input.photoUrls,
  point: input.point,
  seen_at: input.seenAt.toISOString(),
  note: input.note,
  contact_phone: input.contactPhone,
})
