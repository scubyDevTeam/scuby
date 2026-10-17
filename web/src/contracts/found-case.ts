// A found case as anyone reads it (docs/product/05). Its own module so the case page's first load
// carries the shape it reads, not the forms of the custodian and the claimants (found.ts).
import * as z from 'zod/mini'
import { checkinWire } from './checkin'
import { type Color, colorSchema, point, sizeSchema, speciesSchema, timestamp } from './primitives'

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
  /** Set on `converted`: the adoption listing this animal moved to (05 · day-15 offer). */
  successor_case_code: z._default(z.nullable(z.string()), null),
  /** «¿Sigues con él?» (05 · The follow-up loop), when one is due. Only the custodian receives it. */
  pending_checkin: z._default(z.nullable(checkinWire), null),
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
  successorCaseCode: string | null
  pendingCheckin: { id: string; askedAt: Date } | null
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
    successorCaseCode: wire.successor_case_code,
    pendingCheckin: wire.pending_checkin && {
      id: wire.pending_checkin.id,
      askedAt: new Date(wire.pending_checkin.asked_at),
    },
    contact: wire.contact && {
      displayName: wire.contact.display_name,
      whatsappUrl: wire.contact.whatsapp_url,
    },
  }
}
