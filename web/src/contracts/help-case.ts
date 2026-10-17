// A help request as anyone reads it (docs/product/07): a pet, what is asked for it, and how far each
// ask got. Its own module so the case page's first load carries the shape it reads, not the forms
// that offer help or publish a request (help.ts). Help in kind only — there is no amount, goal or
// payment link anywhere on the wire (decision #26).
import * as z from 'zod/mini'
import { checkinWire } from './checkin'
import { type Color, colorSchema, point, sizeSchema, speciesSchema, timestamp } from './primitives'

export const helpStatusSchema = z.enum(['active', 'closed', 'expired', 'removed'])
export const helpResolutionSchema = z.enum([
  'covered',
  'need_ended',
  'pet_deceased',
  'no_response',
  'removed_by_moderation',
])
/** The v1 kinds (D10 defers the rest). A key, never a word: each language names it. */
export const needKindSchema = z.enum(['foster', 'transport', 'supplies'])
export const needStatusSchema = z.enum(['open', 'covered', 'closed'])
/** `verified`: an operator reviewed who is asking (O9). Everything starts `unverified`. */
export const helpTrustTierSchema = z.enum(['unverified', 'verified'])
export const pledgeStatusSchema = z.enum(['pledged', 'confirmed', 'declined', 'withdrawn'])
/** `YYYY-MM-DD`: a day that matters (the vet appointment), never a time. */
export const day = z.string().check(z.regex(/^\d{4}-\d{2}-\d{2}$/))

export type HelpStatus = z.infer<typeof helpStatusSchema>
export type HelpResolution = z.infer<typeof helpResolutionSchema>
export type NeedKind = z.infer<typeof needKindSchema>
export type NeedStatus = z.infer<typeof needStatusSchema>
export type HelpTrustTier = z.infer<typeof helpTrustTierSchema>
export type PledgeStatus = z.infer<typeof pledgeStatusSchema>

const needWire = z.object({
  id: z.string(),
  kind: needKindSchema,
  detail: z.string(),
  /** Null = «lo que puedan». */
  target: z.nullable(z.int().check(z.positive())),
  needed_by: z.nullable(day),
  status: needStatusSchema,
  /** Confirmed by the beneficiary, then promised and not yet confirmed — never one sum. */
  confirmed: z.int().check(z.nonnegative()),
  pledged: z.int().check(z.nonnegative()),
})

/** The viewer's own offers on this request, with the channel each opened. */
const myPledgeWire = z.object({
  id: z.string(),
  need_id: z.string(),
  quantity: z.int().check(z.positive()),
  note: z.nullable(z.string()),
  status: pledgeStatusSchema,
  created_at: timestamp,
  whatsapp_url: z.nullable(z.string()),
})

/** The beneficiary's alone: who offered what, and how to reach them. */
const beneficiaryPledgeWire = z.object({
  id: z.string(),
  need_id: z.string(),
  quantity: z.int().check(z.positive()),
  note: z.nullable(z.string()),
  status: z.enum(['pledged', 'confirmed', 'declined']),
  created_at: timestamp,
  person_name: z.string(),
  /** E.164: a pledge always has a reachable number — a foster we cannot reach is not a foster. */
  phone: z.string(),
  whatsapp_url: z.nullable(z.string()),
})

export const helpCaseWire = z.object({
  code: z.string(),
  vertical: z.literal('help'),
  status: helpStatusSchema,
  resolution: z.nullable(helpResolutionSchema),
  published_at: timestamp,
  resolved_at: z.nullable(timestamp),
  viewer: z.enum(['beneficiary', 'public']),
  pet: z.object({
    name: z.string(),
    species: speciesSchema,
    size: z.nullable(sizeSchema),
    colors: z.array(colorSchema),
    marks: z.nullable(z.string()),
    photo_urls: z.array(z.string()),
  }),
  story: z.string(),
  /** Where the help is needed: an area, rendered at 200 m or more in public (04 · precision). */
  location: z.object({
    center: point,
    radius_m: z.number().check(z.positive()),
    place_name: z.string(),
  }),
  trust_tier: helpTrustTierSchema,
  beneficiary_name: z.string(),
  needs: z.array(needWire).check(z.minLength(1), z.maxLength(3)),
  /** Signed-in viewers only. */
  my_pledges: z._default(z.array(myPledgeWire), []),
  /** The beneficiary only. Withdrawn pledges leave the list. */
  pledges: z._default(z.array(beneficiaryPledgeWire), []),
  pending_checkin: z._default(z.nullable(checkinWire), null),
})

export type HelpNeed = {
  id: string
  kind: NeedKind
  detail: string
  target: number | null
  neededBy: string | null
  status: NeedStatus
  confirmed: number
  pledged: number
}

export type MyPledge = {
  id: string
  needId: string
  quantity: number
  note: string | null
  status: PledgeStatus
  createdAt: Date
  whatsappUrl: string | null
}

export type BeneficiaryPledge = {
  id: string
  needId: string
  quantity: number
  note: string | null
  status: 'pledged' | 'confirmed' | 'declined'
  createdAt: Date
  personName: string
  phone: string
  whatsappUrl: string | null
}

export type HelpCase = {
  code: string
  vertical: 'help'
  status: HelpStatus
  resolution: HelpResolution | null
  publishedAt: Date
  resolvedAt: Date | null
  viewer: 'beneficiary' | 'public'
  pet: {
    name: string
    species: 'dog' | 'cat' | 'other'
    size: 'small' | 'medium' | 'large' | null
    colors: Color[]
    marks: string | null
    photoUrls: string[]
  }
  story: string
  location: { center: { lat: number; lng: number }; radiusM: number; placeName: string }
  trustTier: HelpTrustTier
  beneficiaryName: string
  needs: HelpNeed[]
  myPledges: MyPledge[]
  pledges: BeneficiaryPledge[]
  pendingCheckin: {
    id: string
    trigger: 'time_based' | 'post_recovery_claim'
    claimId: string | null
    askedAt: Date
    archivesAt: Date | null
  } | null
}

export function toHelpCase(wire: z.infer<typeof helpCaseWire>): HelpCase {
  return {
    code: wire.code,
    vertical: 'help',
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
    },
    story: wire.story,
    location: {
      center: wire.location.center,
      radiusM: wire.location.radius_m,
      placeName: wire.location.place_name,
    },
    trustTier: wire.trust_tier,
    beneficiaryName: wire.beneficiary_name,
    needs: wire.needs.map((need) => ({
      id: need.id,
      kind: need.kind,
      detail: need.detail,
      target: need.target,
      neededBy: need.needed_by,
      status: need.status,
      confirmed: need.confirmed,
      pledged: need.pledged,
    })),
    myPledges: wire.my_pledges.map((pledge) => ({
      id: pledge.id,
      needId: pledge.need_id,
      quantity: pledge.quantity,
      note: pledge.note,
      status: pledge.status,
      createdAt: new Date(pledge.created_at),
      whatsappUrl: pledge.whatsapp_url,
    })),
    pledges: wire.pledges.map((pledge) => ({
      id: pledge.id,
      needId: pledge.need_id,
      quantity: pledge.quantity,
      note: pledge.note,
      status: pledge.status,
      createdAt: new Date(pledge.created_at),
      personName: pledge.person_name,
      phone: pledge.phone,
      whatsappUrl: pledge.whatsapp_url,
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
