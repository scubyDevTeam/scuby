// What every publish form asks, whatever the vertical: an animal, an area with a time, and how to
// reach the publisher (docs/product/04 · Publishing and Location precision, docs/eng/auth.md).
// Pre-checks for feedback; the server decides.
import type { Point } from './geo'
import { type PhoneRules, toE164 } from './phone'

export type Species = 'dog' | 'cat' | 'other'
export type PetSize = 'small' | 'medium' | 'large'
export type Color = 'black' | 'white' | 'brown' | 'tan' | 'gray' | 'yellow' | 'orange'

/** «~1 cuadra · ~3 cuadras · ~1 km»: preset chips, never a drag handle. */
export const RADIUS_OPTIONS_M = [100, 300, 1000] as const
export const DEFAULT_RADIUS_M = 300

export type AnimalDraft = {
  name: string
  species: Species | null
  size: PetSize | null
  colors: Color[]
  marks: string
  chipNumber: string
  photoUrls: string[]
}

export type AreaDraft = { center: Point | null; radiusM: number; at: Date | null }

export type ContactDraft = {
  /** National number as typed; ignored when the account already has a verified phone. */
  phone: string
  hasWhatsapp: boolean
  contact: { whatsapp: boolean; email: boolean; inApp: boolean }
}

export const emptyAnimal: AnimalDraft = {
  name: '',
  species: null,
  size: null,
  colors: [],
  marks: '',
  chipNumber: '',
  photoUrls: [],
}
export const emptyArea: AreaDraft = { center: null, radiusM: DEFAULT_RADIUS_M, at: null }
export const emptyContact: ContactDraft = {
  phone: '',
  hasWhatsapp: true,
  contact: { whatsapp: true, email: false, inApp: true },
}

export type DraftError =
  | 'name_required'
  | 'species_required'
  | 'size_required'
  | 'photo_required'
  | 'place_required'
  | 'time_required'
  | 'time_in_the_future'
  | 'phone_invalid'
  | 'contact_required'
  | 'whatsapp_needs_number'

/** An owner knows the name; whoever found a stray does not, and needs a photo instead. */
export function animalErrors(
  animal: AnimalDraft,
  needs: { name: boolean; photo: boolean },
): DraftError[] {
  const errors: DraftError[] = []
  if (needs.name && !animal.name.trim()) errors.push('name_required')
  if (needs.photo && animal.photoUrls.length === 0) errors.push('photo_required')
  if (!animal.species) errors.push('species_required')
  if (!animal.size) errors.push('size_required')
  return errors
}

export function areaErrors(area: AreaDraft, now: Date): DraftError[] {
  const errors: DraftError[] = []
  if (!area.center) errors.push('place_required')
  if (!area.at) errors.push('time_required')
  else if (area.at.getTime() > now.getTime()) errors.push('time_in_the_future')
  return errors
}

export function contactErrors(
  draft: ContactDraft,
  context: { phoneRules: PhoneRules | null; verifiedPhone: string | null },
): DraftError[] {
  const errors: DraftError[] = []
  const needsNumber = !context.verifiedPhone
  if (needsNumber && !(context.phoneRules && toE164(draft.phone, context.phoneRules))) {
    errors.push('phone_invalid')
  }
  const { whatsapp, email, inApp } = draft.contact
  if (!whatsapp && !email && !inApp) errors.push('contact_required')
  // Exposing WhatsApp promises a chat: the publisher has to say the number has it.
  if (whatsapp && !draft.hasWhatsapp) errors.push('whatsapp_needs_number')
  return errors
}
