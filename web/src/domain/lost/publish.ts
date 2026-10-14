// docs/product/04 · Publishing and Location precision: what the publish form asks and checks.
// Pre-checks for feedback; the server decides.
import type { Point } from '../shared/geo'
import { type PhoneRules, toE164 } from '../shared/phone'

/** «~1 cuadra · ~3 cuadras · ~1 km»: preset chips, never a drag handle. */
export const RADIUS_OPTIONS_M = [100, 300, 1000] as const
export const DEFAULT_RADIUS_M = 300

export type Species = 'dog' | 'cat' | 'other'
export type PetSize = 'small' | 'medium' | 'large'

export type LostDraft = {
  /** An existing pet being reported again, or null for a new one. */
  petId: string | null
  name: string
  species: Species | null
  size: PetSize | null
  colors: string[]
  marks: string
  chipNumber: string
  photoUrls: string[]
  center: Point | null
  radiusM: number
  lastSeenAt: Date | null
  /** National number as typed; ignored when the account already has a verified phone. */
  phone: string
  hasWhatsapp: boolean
  contact: { whatsapp: boolean; email: boolean; inApp: boolean }
}

export const emptyDraft: LostDraft = {
  petId: null,
  name: '',
  species: null,
  size: null,
  colors: [],
  marks: '',
  chipNumber: '',
  photoUrls: [],
  center: null,
  radiusM: DEFAULT_RADIUS_M,
  lastSeenAt: null,
  phone: '',
  hasWhatsapp: true,
  contact: { whatsapp: true, email: false, inApp: true },
}

export type DraftError =
  | 'name_required'
  | 'species_required'
  | 'size_required'
  | 'place_required'
  | 'time_required'
  | 'time_in_the_future'
  | 'phone_invalid'
  | 'contact_required'
  | 'whatsapp_needs_number'

export type Step = 1 | 2 | 3

type Context = { now: Date; phoneRules: PhoneRules | null; verifiedPhone: string | null }

/** What stops a step from continuing, in the order the form shows it. */
export function stepErrors(step: Step, draft: LostDraft, context: Context): DraftError[] {
  const errors: DraftError[] = []
  if (step === 1) {
    if (!draft.name.trim()) errors.push('name_required')
    if (!draft.species) errors.push('species_required')
    if (!draft.size) errors.push('size_required')
  }
  if (step === 2) {
    if (!draft.center) errors.push('place_required')
    if (!draft.lastSeenAt) errors.push('time_required')
    else if (draft.lastSeenAt.getTime() > context.now.getTime()) errors.push('time_in_the_future')
  }
  if (step === 3) {
    const needsNumber = !context.verifiedPhone
    if (needsNumber && !(context.phoneRules && toE164(draft.phone, context.phoneRules))) {
      errors.push('phone_invalid')
    }
    const { whatsapp, email, inApp } = draft.contact
    if (!whatsapp && !email && !inApp) errors.push('contact_required')
    // Exposing WhatsApp promises a chat: the publisher has to say the number has it.
    if (whatsapp && !draft.hasWhatsapp) errors.push('whatsapp_needs_number')
  }
  return errors
}

/** An existing pet fills step 1; the owner can still correct it. */
export function draftFromPet(
  draft: LostDraft,
  pet: Pick<LostDraft, 'name' | 'species' | 'size' | 'colors' | 'marks' | 'photoUrls'> & {
    id: string
  },
): LostDraft {
  return {
    ...draft,
    petId: pet.id,
    name: pet.name,
    species: pet.species,
    size: pet.size,
    colors: pet.colors,
    marks: pet.marks,
    photoUrls: pet.photoUrls,
  }
}
