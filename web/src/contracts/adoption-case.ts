// An adoption listing as anyone reads it (docs/product/06). Its own module so the case page's first
// load carries the shape it reads, not the lister's and the adopter's forms (adoption.ts).
import * as z from 'zod/mini'
import { checkinWire } from './checkin'
import { type Color, colorSchema, point, sizeSchema, speciesSchema, timestamp } from './primitives'

export const adoptionStatusSchema = z.enum(['active', 'adopted', 'withdrawn', 'expired'])
export const adoptionResolutionSchema = z.enum([
  'adopted_in_app',
  'adopted_offline',
  'kept',
  'deceased',
  'transferred',
  'no_response',
])
/** Chips describing the animal. */
export const temperamentSchema = z.enum([
  'good_with_kids',
  'good_with_cats',
  'good_with_dogs',
  'senior',
  'puppy',
])
/** Chips describing the home it needs. Curated: extending it is adding a value, never free text. */
export const requirementFlagSchema = z.enum([
  'needs_yard',
  'no_small_children',
  'no_other_dogs',
  'indoor_only',
  'experienced_home',
])
/** On the pet, not the case: a condition travels with the animal through every adoption. */
export const healthFlagSchema = z.enum([
  'chronic_condition',
  'special_needs',
  'senior',
  'fiv_felv',
  'mobility_aid',
  'behavioral_support',
])
/** `verified`: an org whose documents were reviewed. `individual`: identity only. */
export const trustTierSchema = z.enum(['verified', 'individual'])
export const housingSchema = z.enum(['house', 'apartment'])
/** Who the lister is to the animal when the listing creates its pet row. */
export const listerRoleSchema = z.enum(['owner', 'custodian'])
export const withdrawReasonSchema = z.enum(['kept', 'deceased', 'transferred'])

export type AdoptionStatus = z.infer<typeof adoptionStatusSchema>
export type AdoptionResolution = z.infer<typeof adoptionResolutionSchema>
export type Temperament = z.infer<typeof temperamentSchema>
export type RequirementFlag = z.infer<typeof requirementFlagSchema>
export type HealthFlag = z.infer<typeof healthFlagSchema>
export type TrustTier = z.infer<typeof trustTierSchema>
export type Housing = z.infer<typeof housingSchema>
export type ListerRole = z.infer<typeof listerRoleSchema>
export type WithdrawReason = z.infer<typeof withdrawReasonSchema>

/** «Me interesa»: four fields and a free-text «¿por qué este?», before any channel opens. */
export const introSchema = z.object({
  housing: housingSchema,
  has_yard: z.boolean(),
  other_pets: z.nullable(z.string().check(z.maxLength(300))),
  household: z.nullable(z.string().check(z.maxLength(300))),
  why: z.string().check(z.minLength(1), z.maxLength(1000)),
})

const listerInterestWire = z.object({
  id: z.string(),
  /** Withdrawn interests leave the list: that is what keeps it honest. */
  status: z.enum(['open', 'chosen', 'declined']),
  created_at: timestamp,
  /** Facts from the account, never a verdict (06 · What the lister sees). */
  person: z.object({
    display_name: z.string(),
    city: z.nullable(z.string()),
    member_since: timestamp,
    sightings_reported: z.int().check(z.nonnegative()),
    /** Across every active listing: the collector signal, surfaced as a number and nothing else. */
    open_adoption_interests: z.int().check(z.nonnegative()),
  }),
  intro: introSchema,
  /** The conversation link: the adopter's verified number, when it has WhatsApp. */
  whatsapp_url: z.nullable(z.string()),
})

/** The viewer's own interest. A decline is silent: the adopter never sees `declined`. */
const myInterestWire = z.object({
  id: z.string(),
  status: z.enum(['open', 'chosen', 'withdrawn']),
  created_at: timestamp,
  whatsapp_url: z.nullable(z.string()),
  external_url: z.nullable(z.string()),
})

export const adoptionCaseWire = z.object({
  code: z.string(),
  vertical: z.literal('adoption'),
  status: adoptionStatusSchema,
  resolution: z.nullable(adoptionResolutionSchema),
  published_at: timestamp,
  resolved_at: z.nullable(timestamp),
  viewer: z.enum(['lister', 'public']),
  pet: z.object({
    name: z.string(),
    species: speciesSchema,
    size: z.nullable(sizeSchema),
    colors: z.array(colorSchema),
    marks: z.nullable(z.string()),
    photo_urls: z.array(z.string()),
    health_flags: z.array(healthFlagSchema),
  }),
  story: z.string(),
  temperament: z.array(temperamentSchema),
  requirement_flags: z.array(requirementFlagSchema),
  requirements: z.nullable(z.string()),
  /** Where the animal is: an area, rendered at 200 m or more in public — the lost/found rule. */
  location: z.object({
    center: point,
    radius_m: z.number().check(z.positive()),
    place_name: z.string(),
  }),
  trust_tier: trustTierSchema,
  lister_name: z.string(),
  /** «En proceso»: someone was chosen. Never a status — a badge and a ranking weight. */
  reserved: z.boolean(),
  /** Signed-in viewers only: their own interest, with the channel it opened. */
  my_interest: z._default(z.nullable(myInterestWire), null),
  /** The lister's alone: who is interested, and the question the follow-up loop is asking. */
  interests: z._default(z.array(listerInterestWire), []),
  pending_checkin: z._default(z.nullable(checkinWire), null),
})

export type AdoptionInterest = {
  id: string
  status: 'open' | 'chosen' | 'declined'
  createdAt: Date
  person: {
    displayName: string
    city: string | null
    memberSince: Date
    sightingsReported: number
    openAdoptionInterests: number
  }
  intro: Intro
  whatsappUrl: string | null
}

export type Intro = {
  housing: Housing
  hasYard: boolean
  otherPets: string | null
  household: string | null
  why: string
}

export type MyInterest = {
  id: string
  status: 'open' | 'chosen' | 'withdrawn'
  createdAt: Date
  whatsappUrl: string | null
  externalUrl: string | null
}

export type AdoptionCase = {
  code: string
  vertical: 'adoption'
  status: AdoptionStatus
  resolution: AdoptionResolution | null
  publishedAt: Date
  resolvedAt: Date | null
  viewer: 'lister' | 'public'
  pet: {
    name: string
    species: 'dog' | 'cat' | 'other'
    size: 'small' | 'medium' | 'large' | null
    colors: Color[]
    marks: string | null
    photoUrls: string[]
    healthFlags: HealthFlag[]
  }
  story: string
  temperament: Temperament[]
  requirementFlags: RequirementFlag[]
  requirements: string | null
  location: { center: { lat: number; lng: number }; radiusM: number; placeName: string }
  trustTier: TrustTier
  listerName: string
  reserved: boolean
  myInterest: MyInterest | null
  interests: AdoptionInterest[]
  pendingCheckin: {
    id: string
    trigger: 'time_based' | 'post_recovery_claim'
    claimId: string | null
    askedAt: Date
    archivesAt: Date | null
  } | null
}

const toIntro = (wire: z.infer<typeof introSchema>): Intro => ({
  housing: wire.housing,
  hasYard: wire.has_yard,
  otherPets: wire.other_pets,
  household: wire.household,
  why: wire.why,
})

export function toAdoptionCase(wire: z.infer<typeof adoptionCaseWire>): AdoptionCase {
  return {
    code: wire.code,
    vertical: 'adoption',
    status: wire.status,
    resolution: wire.resolution,
    publishedAt: new Date(wire.published_at),
    resolvedAt: wire.resolved_at ? new Date(wire.resolved_at) : null,
    viewer: wire.viewer,
    pet: {
      name: wire.pet.name,
      species: wire.pet.species,
      size: wire.pet.size,
      colors: wire.pet.colors,
      marks: wire.pet.marks,
      photoUrls: wire.pet.photo_urls,
      healthFlags: wire.pet.health_flags,
    },
    story: wire.story,
    temperament: wire.temperament,
    requirementFlags: wire.requirement_flags,
    requirements: wire.requirements,
    location: {
      center: wire.location.center,
      radiusM: wire.location.radius_m,
      placeName: wire.location.place_name,
    },
    trustTier: wire.trust_tier,
    listerName: wire.lister_name,
    reserved: wire.reserved,
    myInterest: wire.my_interest && {
      id: wire.my_interest.id,
      status: wire.my_interest.status,
      createdAt: new Date(wire.my_interest.created_at),
      whatsappUrl: wire.my_interest.whatsapp_url,
      externalUrl: wire.my_interest.external_url,
    },
    interests: wire.interests.map((interest) => ({
      id: interest.id,
      status: interest.status,
      createdAt: new Date(interest.created_at),
      person: {
        displayName: interest.person.display_name,
        city: interest.person.city,
        memberSince: new Date(interest.person.member_since),
        sightingsReported: interest.person.sightings_reported,
        openAdoptionInterests: interest.person.open_adoption_interests,
      },
      intro: toIntro(interest.intro),
      whatsappUrl: interest.whatsapp_url,
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
  }
}
