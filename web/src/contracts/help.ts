// What people do on a help request (docs/product/07): publish one, offer help («Yo ayudo»), and the
// beneficiary's answers. Help in kind only: no field takes an amount, a link or an account
// (decision #26). The reading half lives in help-case.ts, so the case page does not download these.
import * as z from 'zod/mini'
import { day, needKindSchema } from './help-case'
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

export * from './help-case'

// --- Publishing a request (07 · Publishing) ---

export type NeedInput = {
  kind: 'foster' | 'transport' | 'supplies'
  detail: string
  target: number | null
  neededBy: string | null
}

export type PublishHelpInput = {
  /** One of the beneficiary's pets, or null to create it — the beneficiary becomes its owner. */
  petId: string | null
  pet: {
    name: string
    species: 'dog' | 'cat' | 'other'
    size: 'small' | 'medium' | 'large'
    colors: Color[]
    marks: string | null
    photoUrls: string[]
  } | null
  needs: NeedInput[]
  story: string
  center: { lat: number; lng: number }
  radiusM: number
  phone: string | null
  hasWhatsapp: boolean
  contact: { whatsapp: boolean; email: boolean; inApp: boolean }
  otpCode: string | null
}

const needRequest = z.object({
  kind: needKindSchema,
  detail: z.string().check(z.minLength(1), z.maxLength(300)),
  target: z.nullable(z.int().check(z.positive(), z.lte(999))),
  needed_by: z.nullable(day),
})

export const publishHelpRequest = z.object({
  /** One of the caller's pets. With null, `pet` describes a new one and its owner link opens. */
  pet_id: z.nullable(z.string()),
  pet: z.nullable(
    z.object({
      name: z.string().check(z.minLength(1), z.maxLength(60)),
      species: speciesSchema,
      size: sizeSchema,
      colors: z.array(colorSchema),
      marks: z.nullable(z.string().check(z.maxLength(500))),
      photo_urls: z.array(photoUrl).check(z.maxLength(6)),
    }),
  ),
  /** A request is always a bounded ask: one to three needs, each saying exactly what. */
  needs: z.array(needRequest).check(z.minLength(1), z.maxLength(3)),
  story: z.string().check(z.minLength(1), z.maxLength(2000)),
  location_point: point,
  location_radius_m: z.number().check(z.positive(), z.lte(5000)),
  ...publisherPhone,
})

export const publishHelpBody = (input: PublishHelpInput): z.input<typeof publishHelpRequest> => ({
  pet_id: input.petId,
  pet: input.pet && {
    name: input.pet.name,
    species: input.pet.species,
    size: input.pet.size,
    colors: input.pet.colors,
    marks: input.pet.marks,
    photo_urls: input.pet.photoUrls,
  },
  needs: input.needs.map((need) => ({
    kind: need.kind,
    detail: need.detail,
    target: need.target,
    needed_by: need.neededBy,
  })),
  story: input.story,
  location_point: input.center,
  location_radius_m: input.radiusM,
  phone: input.phone,
  phone_has_whatsapp: input.hasWhatsapp,
  contact_prefs: {
    expose_whatsapp: input.contact.whatsapp,
    expose_email: input.contact.email,
    in_app_only: input.contact.inApp && !input.contact.whatsapp && !input.contact.email,
  },
  otp_code: input.otpCode,
})

// --- «Yo ayudo» (07 · `help_pledge`) ---

export type PledgeInput = {
  needId: string
  quantity: number
  note: string | null
  /** E.164, or null to keep the account's verified number. A pledge needs a reachable one. */
  phone: string | null
  hasWhatsapp: boolean
  otpCode: string | null
}

export const pledgeRequest = z.object({
  need_id: z.string(),
  quantity: z.int().check(z.positive(), z.lte(99)),
  note: z.nullable(z.string().check(z.maxLength(300))),
  phone: z.nullable(phone),
  phone_has_whatsapp: z.boolean(),
  otp_code: z.nullable(z.string().check(z.regex(/^\d{6}$/))),
})

export const pledgeBody = (input: PledgeInput): z.input<typeof pledgeRequest> => ({
  need_id: input.needId,
  quantity: input.quantity,
  note: input.note,
  phone: input.phone,
  phone_has_whatsapp: input.hasWhatsapp,
  otp_code: input.otpCode,
})

/**
 * The row first, then the channel to the beneficiary, per their contact prefs (null = in-app only).
 * `phone_step: otp` = the number must be verified first: send again with `otp_code`.
 */
export const pledgeWire = z.union([
  z.object({ phone_step: z.literal('otp') }),
  z.object({ id: z.string(), whatsapp_url: z.nullable(z.string()) }),
])

export type PledgeResult =
  | { kind: 'otp' }
  | { kind: 'sent'; id: string; whatsappUrl: string | null }

export function parsePledge(raw: unknown): PledgeResult {
  const wire = pledgeWire.parse(raw)
  return 'id' in wire
    ? { kind: 'sent', id: wire.id, whatsappUrl: wire.whatsapp_url }
    : { kind: 'otp' }
}

/** Only the beneficiary says what arrived (07 · `help_pledge`). */
export const answerPledgeRequest = z.object({ status: z.enum(['confirmed', 'declined']) })

/** «Ya no necesita ayuda», with its reason. Every need covered closes the request by itself. */
export const closeHelpReasonSchema = z.enum(['need_ended', 'pet_deceased'])
export type CloseHelpReason = z.infer<typeof closeHelpReasonSchema>
export const closeHelpRequest = z.object({ resolution: closeHelpReasonSchema })
