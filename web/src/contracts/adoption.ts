// An adoption listing and what its lister and the people interested in it do (docs/product/06).
// v1 is a listing, not a screening inbox: «Me interesa» with a 4-field intro, screening in chat, an
// outcome that transfers responsibility. The B2P seams (`lane`, `kind`, `form_data`) live in the
// rows, not on the wire: nothing reads them yet.
// The reading half lives in adoption-case.ts, so the case page does not download these forms.
import * as z from 'zod/mini'
import {
  type HealthFlag,
  healthFlagSchema,
  type Intro,
  introSchema,
  type ListerRole,
  listerRoleSchema,
  type RequirementFlag,
  requirementFlagSchema,
  type Temperament,
  temperamentSchema,
  withdrawReasonSchema,
} from './adoption-case'
import { publisherPhone } from './owner'
import {
  type Color,
  colorSchema,
  phone,
  photoUrl,
  point,
  sizeSchema,
  speciesSchema,
} from './primitives'

export * from './adoption-case'

// --- Publishing a listing (06 · adoption_case) ---

export type PublishAdoptionInput = {
  /** The found case this listing converts (05 · the day-15 offer), or null for a new pet. */
  fromFoundCaseCode: string | null
  listerRole: ListerRole
  name: string
  species: 'dog' | 'cat' | 'other'
  size: 'small' | 'medium' | 'large'
  colors: Color[]
  marks: string | null
  photoUrls: string[]
  healthFlags: HealthFlag[]
  story: string
  temperament: Temperament[]
  requirementFlags: RequirementFlag[]
  requirements: string | null
  center: { lat: number; lng: number }
  radiusM: number
  externalUrl: string | null
  phone: string | null
  hasWhatsapp: boolean
  contact: { whatsapp: boolean; email: boolean; inApp: boolean }
  otpCode: string | null
}

export const publishAdoptionRequest = z.object({
  /** Set when a found case becomes this listing: same pet row, the found case `converted`. */
  from_found_case_code: z.nullable(z.string()),
  /** Ignored with `from_found_case_code`: the custodian link continues as it was. */
  lister_role: listerRoleSchema,
  pet: z.object({
    name: z.string().check(z.minLength(1), z.maxLength(60)),
    species: speciesSchema,
    size: sizeSchema,
    colors: z.array(colorSchema),
    marks: z.nullable(z.string().check(z.maxLength(500))),
    photo_urls: z.array(photoUrl).check(z.minLength(1), z.maxLength(6)),
    health_flags: z.array(healthFlagSchema),
  }),
  story: z.string().check(z.minLength(1), z.maxLength(2000)),
  temperament: z.array(temperamentSchema),
  requirement_flags: z.array(requirementFlagSchema),
  requirements: z.nullable(z.string().check(z.maxLength(1000))),
  location_point: point,
  location_radius_m: z.number().check(z.positive(), z.lte(5000)),
  /** An org's own application page. Independent of WhatsApp: a listing can have both. */
  external_url: z.nullable(z.string().check(z.regex(/^https?:\/\/\S+\.\S+/), z.maxLength(500))),
  ...publisherPhone,
})

export const publishAdoptionBody = (
  input: PublishAdoptionInput,
): z.input<typeof publishAdoptionRequest> => ({
  from_found_case_code: input.fromFoundCaseCode,
  lister_role: input.listerRole,
  pet: {
    name: input.name,
    species: input.species,
    size: input.size,
    colors: input.colors,
    marks: input.marks,
    photo_urls: input.photoUrls,
    health_flags: input.healthFlags,
  },
  story: input.story,
  temperament: input.temperament,
  requirement_flags: input.requirementFlags,
  requirements: input.requirements,
  location_point: input.center,
  location_radius_m: input.radiusM,
  external_url: input.externalUrl,
  phone: input.phone,
  phone_has_whatsapp: input.hasWhatsapp,
  contact_prefs: {
    expose_whatsapp: input.contact.whatsapp,
    expose_email: input.contact.email,
    in_app_only: input.contact.inApp && !input.contact.whatsapp && !input.contact.email,
  },
  otp_code: input.otpCode,
})

// --- «Me interesa» (06 · adoption_interest) ---

export type InterestInput = {
  intro: Intro
  /** E.164, or null to keep the account's verified number. «Me interesa» needs one verified. */
  phone: string | null
  hasWhatsapp: boolean
  otpCode: string | null
}

export const interestRequest = z.object({
  intro: introSchema,
  phone: z.nullable(phone),
  phone_has_whatsapp: z.boolean(),
  otp_code: z.nullable(z.string().check(z.regex(/^\d{6}$/))),
})

export const interestBody = (input: InterestInput): z.input<typeof interestRequest> => ({
  intro: {
    housing: input.intro.housing,
    has_yard: input.intro.hasYard,
    other_pets: input.intro.otherPets,
    household: input.intro.household,
    why: input.intro.why,
  },
  phone: input.phone,
  phone_has_whatsapp: input.hasWhatsapp,
  otp_code: input.otpCode,
})

/**
 * The row first, then the channel: the answer names every channel the lister enabled. None means
 * in-app only. `phone_step: otp` = the number must be verified first: send again with `otp_code`.
 */
export const interestWire = z.union([
  z.object({ phone_step: z.literal('otp') }),
  z.object({
    id: z.string(),
    whatsapp_url: z.nullable(z.string()),
    external_url: z.nullable(z.string()),
  }),
])

export type InterestResult =
  | { kind: 'otp' }
  | { kind: 'sent'; id: string; whatsappUrl: string | null; externalUrl: string | null }

export function parseInterest(raw: unknown): InterestResult {
  const wire = interestWire.parse(raw)
  return 'id' in wire
    ? { kind: 'sent', id: wire.id, whatsappUrl: wire.whatsapp_url, externalUrl: wire.external_url }
    : { kind: 'otp' }
}

/** The lister's three moves on an interest: choose it, decline it, or put it back on the list. */
export const answerInterestRequest = z.object({ status: z.enum(['chosen', 'declined', 'open']) })

/** «¿Quién lo adoptó?»: one of the interests, or null for «fuera de la app». */
export const recordAdoptionRequest = z.object({ interest_id: z.nullable(z.string()) })

/** «Ya no está disponible»: one exit, with its reason (06 · no `cancelled` on adoption). */
export const withdrawAdoptionRequest = z.object({ resolution: withdrawReasonSchema })
