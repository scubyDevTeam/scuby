// A case as anyone reads it by its short code (docs/product/04, 05, 10 §1). Source of the contract:
// api.ts lists the endpoints, ../../../docs/eng/openapi.json is generated from it.
import * as z from 'zod/mini'
import { type FoundCase, foundCaseWire, toFoundCase } from './found'
import {
  type Color,
  colorSchema,
  type PetSize,
  phone,
  point,
  type Species,
  sizeSchema,
  speciesSchema,
  timestamp,
  type Vertical,
  verticalSchema,
} from './primitives'

export type { Color, PetSize, Species, Vertical }
export { colorSchema, sizeSchema, speciesSchema, verticalSchema }

export const lostStatusSchema = z.enum(['active', 'reunited', 'expired', 'cancelled'])

export const sightingWire = z.object({
  id: z.string(),
  point,
  seen_at: timestamp,
  note: z.nullable(z.string()),
  photo_urls: z.array(z.string()),
  source: z.enum(['anonymous', 'registered']),
  highlighted_by_owner: z.boolean(),
  /** The owner's alone: the reporter's number, and the pins the owner took off the public map. */
  contact_phone: z._default(z.nullable(phone), null),
  hidden: z._default(z.boolean(), false),
})

/** One question the owner owes an answer to (docs/product/04 · The follow-up loop). */
export const checkinWire = z.object({
  id: z.string(),
  trigger: z.enum(['time_based', 'post_recovery_claim']),
  /** Set on a claim check-in: the claim the three answers are about. */
  claim_id: z.nullable(z.string()),
  asked_at: timestamp,
})

export const lostCaseWire = z.object({
  code: z.string(),
  vertical: z.literal('lost'),
  status: lostStatusSchema,
  resolved_at: z.nullable(timestamp),
  viewer: z.enum(['owner', 'public']),
  pet: z.object({
    name: z.string(),
    species: speciesSchema,
    size: z.nullable(sizeSchema),
    colors: z.array(colorSchema),
    marks: z.nullable(z.string()),
    photo_urls: z.array(z.string()),
  }),
  last_seen: z.object({
    center: point,
    radius_m: z.number().check(z.positive()),
    at: timestamp,
    place_name: z.string(),
  }),
  open_claim_count: z.int().check(z.nonnegative()),
  sightings: z.array(sightingWire),
  /** Who says they have the animal. Only the owner receives these. */
  claims: z._default(
    z.array(
      z.object({
        id: z.string(),
        phone,
        created_at: timestamp,
        status: z.enum(['open', 'confirmed', 'dismissed', 'stale']),
      }),
    ),
    [],
  ),
  /** The oldest unanswered check-in. Only the owner receives it. */
  pending_checkin: z._default(z.nullable(checkinWire), null),
  contact: z.nullable(z.object({ display_name: z.string(), whatsapp_url: z.nullable(z.string()) })),
})

/** Verticals whose page is not built yet still resolve, with the card's worth of data. */
export const otherCaseWire = z.object({
  code: z.string(),
  vertical: z.enum(['adoption', 'help']),
  status: z.string(),
  title: z.string(),
  place_name: z.string(),
  photo_url: z.nullable(z.string()),
})

export const caseWire = z.discriminatedUnion('vertical', [
  lostCaseWire,
  foundCaseWire,
  otherCaseWire,
])

export type Sighting = {
  id: string
  point: { lat: number; lng: number }
  seenAt: Date
  note: string | null
  photoUrls: string[]
  source: 'anonymous' | 'registered'
  highlightedByOwner: boolean
  contactPhone: string | null
  hidden: boolean
}

export type Checkin = {
  id: string
  trigger: 'time_based' | 'post_recovery_claim'
  claimId: string | null
  askedAt: Date
}

export type RecoveryClaim = {
  id: string
  /** E.164: format-validated when collected, so it can be a button, never text to retype. */
  phone: string
  createdAt: Date
  status: 'open' | 'confirmed' | 'dismissed' | 'stale'
}

export type LostCase = {
  code: string
  vertical: 'lost'
  status: z.infer<typeof lostStatusSchema>
  resolvedAt: Date | null
  viewer: 'owner' | 'public'
  pet: {
    name: string
    species: Species
    size: PetSize | null
    colors: Color[]
    marks: string | null
    photoUrls: string[]
  }
  lastSeen: { center: { lat: number; lng: number }; radiusM: number; at: Date; placeName: string }
  openClaimCount: number
  sightings: Sighting[]
  claims: RecoveryClaim[]
  pendingCheckin: Checkin | null
  contact: { displayName: string; whatsappUrl: string | null } | null
}

export type OtherCase = {
  code: string
  vertical: 'adoption' | 'help'
  status: string
  title: string
  placeName: string
  photoUrl: string | null
}

export type CaseDetail = LostCase | FoundCase | OtherCase

export function parseCase(raw: unknown): CaseDetail {
  const wire = caseWire.parse(raw)
  if (wire.vertical === 'found') return toFoundCase(wire)
  if (wire.vertical !== 'lost') {
    return {
      code: wire.code,
      vertical: wire.vertical,
      status: wire.status,
      title: wire.title,
      placeName: wire.place_name,
      photoUrl: wire.photo_url,
    }
  }
  return {
    code: wire.code,
    vertical: 'lost',
    status: wire.status,
    resolvedAt: wire.resolved_at ? new Date(wire.resolved_at) : null,
    viewer: wire.viewer,
    pet: {
      name: wire.pet.name,
      species: wire.pet.species,
      size: wire.pet.size,
      colors: wire.pet.colors,
      marks: wire.pet.marks,
      photoUrls: wire.pet.photo_urls,
    },
    lastSeen: {
      center: wire.last_seen.center,
      radiusM: wire.last_seen.radius_m,
      at: new Date(wire.last_seen.at),
      placeName: wire.last_seen.place_name,
    },
    openClaimCount: wire.open_claim_count,
    sightings: wire.sightings.map((s) => ({
      id: s.id,
      point: s.point,
      seenAt: new Date(s.seen_at),
      note: s.note,
      photoUrls: s.photo_urls,
      source: s.source,
      highlightedByOwner: s.highlighted_by_owner,
      contactPhone: s.contact_phone,
      hidden: s.hidden,
    })),
    claims: wire.claims.map((claim) => ({
      id: claim.id,
      phone: claim.phone,
      createdAt: new Date(claim.created_at),
      status: claim.status,
    })),
    pendingCheckin: wire.pending_checkin && {
      id: wire.pending_checkin.id,
      trigger: wire.pending_checkin.trigger,
      claimId: wire.pending_checkin.claim_id,
      askedAt: new Date(wire.pending_checkin.asked_at),
    },
    contact: wire.contact && {
      displayName: wire.contact.display_name,
      whatsappUrl: wire.contact.whatsapp_url,
    },
  }
}
