// hand-written until O14 — provisional wire shapes for what a signed-in owner reads and sends.
import { z } from 'zod'
import { sizeSchema, speciesSchema, verticalSchema } from './case'

const petWire = z.object({
  id: z.string(),
  name: z.string(),
  species: speciesSchema,
  size: sizeSchema.nullable(),
  colors: z.array(z.string()),
  marks: z.string().nullable(),
  photo_urls: z.array(z.string()),
  /** Set while the pet has an active lost case: a second one is blocked (04 · Publishing). */
  active_case_code: z.string().nullable(),
})

export type Pet = {
  id: string
  name: string
  species: z.infer<typeof speciesSchema>
  size: z.infer<typeof sizeSchema> | null
  colors: string[]
  marks: string | null
  photoUrls: string[]
  activeCaseCode: string | null
}

export function parsePets(raw: unknown): Pet[] {
  return z
    .array(petWire)
    .parse(raw)
    .map((pet) => ({
      id: pet.id,
      name: pet.name,
      species: pet.species,
      size: pet.size,
      colors: pet.colors,
      marks: pet.marks,
      photoUrls: pet.photo_urls,
      activeCaseCode: pet.active_case_code,
    }))
}

const myCaseWire = z.object({
  code: z.string(),
  vertical: verticalSchema,
  status: z.string(),
  title: z.string(),
  place_name: z.string(),
  photo_url: z.string().nullable(),
  published_at: z.iso.datetime({ offset: true }),
  open_claim_count: z.number().int().nonnegative(),
})

export type MyCase = {
  code: string
  vertical: z.infer<typeof verticalSchema>
  status: string
  title: string
  placeName: string
  photoUrl: string | null
  publishedAt: Date
  openClaimCount: number
}

export function parseMyCases(raw: unknown): MyCase[] {
  return z
    .array(myCaseWire)
    .parse(raw)
    .map((item) => ({
      code: item.code,
      vertical: item.vertical,
      status: item.status,
      title: item.title,
      placeName: item.place_name,
      photoUrl: item.photo_url,
      publishedAt: new Date(item.published_at),
      openClaimCount: item.open_claim_count,
    }))
}

export type PublishLostInput = {
  petId: string | null
  name: string
  species: z.infer<typeof speciesSchema>
  size: z.infer<typeof sizeSchema>
  colors: string[]
  marks: string | null
  chipNumber: string | null
  photoUrls: string[]
  center: { lat: number; lng: number }
  radiusM: number
  lastSeenAt: Date
  /** E.164, or null to keep the account's verified number. */
  phone: string | null
  hasWhatsapp: boolean
  contact: { whatsapp: boolean; email: boolean; inApp: boolean }
  /** The SMS code, on the second attempt of a publish that answered `otp`. */
  otpCode: string | null
}

export const publishLostBody = (input: PublishLostInput) => ({
  pet_id: input.petId,
  pet: {
    name: input.name,
    species: input.species,
    size: input.size,
    colors: input.colors,
    marks: input.marks,
    chip_number: input.chipNumber,
    photo_urls: input.photoUrls,
  },
  last_seen_point: input.center,
  last_seen_radius_m: input.radiusM,
  last_seen_at: input.lastSeenAt.toISOString(),
  phone: input.phone,
  phone_has_whatsapp: input.hasWhatsapp,
  contact_prefs: {
    expose_whatsapp: input.contact.whatsapp,
    expose_email: input.contact.email,
    in_app_only: input.contact.inApp && !input.contact.whatsapp && !input.contact.email,
  },
  otp_code: input.otpCode,
})

/**
 * The server decides whether the number needs its SMS code (frontend.md · Rule 3: the client never
 * reads the flag). `otp` = a code was sent, send it back; `published` = the case is live.
 */
const publishWire = z.union([
  z.object({ phone_step: z.literal('otp') }),
  z.object({ code: z.string() }),
])

export type PublishResult = { kind: 'otp' } | { kind: 'published'; code: string }

export function parsePublish(raw: unknown): PublishResult {
  const wire = publishWire.parse(raw)
  return 'code' in wire ? { kind: 'published', code: wire.code } : { kind: 'otp' }
}

export const parseUpload = (raw: unknown) => z.object({ url: z.string() }).parse(raw).url
