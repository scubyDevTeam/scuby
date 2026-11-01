// A case as anyone reads it by its short code (docs/product/04, 05, 10 §1). Source of the contract:
// api.ts lists the endpoints, ../../../docs/eng/openapi.json is generated from it.
import * as z from 'zod/mini'
import { type AdoptionCase, adoptionCaseWire, toAdoptionCase } from './adoption-case'
import { checkinWire } from './checkin'
import { type FoundCase, foundCaseWire, toFoundCase } from './found-case'
import { type HelpCase, helpCaseWire, toHelpCase } from './help-case'
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
export { checkinWire, colorSchema, sizeSchema, speciesSchema, verticalSchema }

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
  /** The pin this account or device sent: the reporter's own, whatever its age. */
  mine: z._default(z.boolean(), false),
  /**
   * Only on one's own pin, and only until `created_at + 15 min` (docs/product/04 · Correction
   * window): the time left to correct or delete it. Null once the pin is part of the record.
   */
  editable_until: z._default(z.nullable(timestamp), null),
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
  /**
   * Only the owner receives it (null otherwise): a claim must never reduce reach (docs/product/04 · Rule: a recovery
   * claim must never reduce reach). Open, non-stale claims on an active case; 0 once the case is closed.
   */
  open_claim_count: z.nullable(z.int().check(z.nonnegative())),
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

export const caseWire = z.discriminatedUnion('vertical', [
  lostCaseWire,
  foundCaseWire,
  adoptionCaseWire,
  helpCaseWire,
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
  mine: boolean
  editableUntil: Date | null
}

export type Checkin = {
  id: string
  trigger: 'time_based' | 'post_recovery_claim'
  claimId: string | null
  askedAt: Date
  archivesAt: Date | null
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
  openClaimCount: number | null
  sightings: Sighting[]
  claims: RecoveryClaim[]
  pendingCheckin: Checkin | null
  contact: { displayName: string; whatsappUrl: string | null } | null
}

export type CaseDetail = LostCase | FoundCase | AdoptionCase | HelpCase

export function parseCase(raw: unknown): CaseDetail {
  const wire = caseWire.parse(raw)
  if (wire.vertical === 'found') return toFoundCase(wire)
  if (wire.vertical === 'adoption') return toAdoptionCase(wire)
  if (wire.vertical === 'help') return toHelpCase(wire)

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
      mine: s.mine,
      editableUntil: s.editable_until ? new Date(s.editable_until) : null,
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
      archivesAt: wire.pending_checkin.archives_at
        ? new Date(wire.pending_checkin.archives_at)
        : null,
    },
    contact: wire.contact && {
      displayName: wire.contact.display_name,
      whatsappUrl: wire.contact.whatsapp_url,
    },
  }
}
