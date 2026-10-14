// hand-written until O14 — the API has no published spec yet, so this wire shape is provisional.
import { z } from 'zod'

const point = z.object({ lat: z.number(), lng: z.number() })
const timestamp = z.iso.datetime({ offset: true })

export const verticalSchema = z.enum(['lost', 'found', 'adoption', 'help'])
export const speciesSchema = z.enum(['dog', 'cat', 'other'])
export const sizeSchema = z.enum(['small', 'medium', 'large'])
export const lostStatusSchema = z.enum(['active', 'reunited', 'expired', 'cancelled'])

const sightingWire = z.object({
  id: z.string(),
  point,
  seen_at: timestamp,
  note: z.string().nullable(),
  photo_url: z.string().nullable(),
  source: z.enum(['anonymous', 'registered']),
  highlighted_by_owner: z.boolean(),
})

export const lostCaseWire = z.object({
  code: z.string(),
  vertical: z.literal('lost'),
  status: lostStatusSchema,
  resolved_at: timestamp.nullable(),
  viewer: z.enum(['owner', 'public']),
  pet: z.object({
    name: z.string(),
    species: speciesSchema,
    size: sizeSchema.nullable(),
    colors: z.array(z.string()),
    marks: z.string().nullable(),
    photo_urls: z.array(z.string()),
  }),
  last_seen: z.object({
    center: point,
    radius_m: z.number().positive(),
    at: timestamp,
    place_name: z.string(),
  }),
  open_claim_count: z.number().int().nonnegative(),
  sightings: z.array(sightingWire),
  /** Who says they have the animal. Only the owner receives these. */
  claims: z
    .array(
      z.object({
        id: z.string(),
        phone: z.string(),
        created_at: timestamp,
        status: z.enum(['open', 'confirmed', 'dismissed', 'stale']),
      }),
    )
    .default([]),
  contact: z.object({ display_name: z.string(), whatsapp_url: z.string().nullable() }).nullable(),
})

/** Verticals whose page is not built yet still resolve, with the card's worth of data. */
export const otherCaseWire = z.object({
  code: z.string(),
  vertical: z.enum(['found', 'adoption', 'help']),
  status: z.string(),
  title: z.string(),
  place_name: z.string(),
  photo_url: z.string().nullable(),
})

export const caseWire = z.discriminatedUnion('vertical', [lostCaseWire, otherCaseWire])

export type Vertical = z.infer<typeof verticalSchema>
export type Species = z.infer<typeof speciesSchema>
export type PetSize = z.infer<typeof sizeSchema>

export type Sighting = {
  id: string
  point: { lat: number; lng: number }
  seenAt: Date
  note: string | null
  photoUrl: string | null
  source: 'anonymous' | 'registered'
  highlightedByOwner: boolean
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
    colors: string[]
    marks: string | null
    photoUrls: string[]
  }
  lastSeen: { center: { lat: number; lng: number }; radiusM: number; at: Date; placeName: string }
  openClaimCount: number
  sightings: Sighting[]
  claims: RecoveryClaim[]
  contact: { displayName: string; whatsappUrl: string | null } | null
}

export type OtherCase = {
  code: string
  vertical: 'found' | 'adoption' | 'help'
  status: string
  title: string
  placeName: string
  photoUrl: string | null
}

export type CaseDetail = LostCase | OtherCase

export function parseCase(raw: unknown): CaseDetail {
  const wire = caseWire.parse(raw)
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
      photoUrl: s.photo_url,
      source: s.source,
      highlightedByOwner: s.highlighted_by_owner,
    })),
    claims: wire.claims.map((claim) => ({
      id: claim.id,
      phone: claim.phone,
      createdAt: new Date(claim.created_at),
      status: claim.status,
    })),
    contact: wire.contact && {
      displayName: wire.contact.display_name,
      whatsappUrl: wire.contact.whatsapp_url,
    },
  }
}
