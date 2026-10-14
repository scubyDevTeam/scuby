// docs/product/04 · Publishing: the lost form, as three steps over the shared publish checks.
import type { Point } from '../shared/geo'
import type { PhoneRules } from '../shared/phone'
import {
  type AnimalDraft,
  animalErrors,
  areaErrors,
  type ContactDraft,
  contactErrors,
  type DraftError,
  emptyAnimal,
  emptyArea,
  emptyContact,
} from '../shared/publish'

export {
  DEFAULT_RADIUS_M,
  type DraftError,
  type PetSize,
  RADIUS_OPTIONS_M,
  type Species,
} from '../shared/publish'

export type LostDraft = AnimalDraft &
  ContactDraft & {
    /** An existing pet being reported again, or null for a new one. */
    petId: string | null
    center: Point | null
    radiusM: number
    lastSeenAt: Date | null
  }

export const emptyDraft: LostDraft = {
  ...emptyAnimal,
  ...emptyContact,
  petId: null,
  center: emptyArea.center,
  radiusM: emptyArea.radiusM,
  lastSeenAt: null,
}

export type Step = 1 | 2 | 3

type Context = { now: Date; phoneRules: PhoneRules | null; verifiedPhone: string | null }

/** What stops a step from continuing, in the order the form shows it. */
export function stepErrors(step: Step, draft: LostDraft, context: Context): DraftError[] {
  if (step === 1) return animalErrors(draft, { name: true, photo: false })
  if (step === 2) {
    return areaErrors(
      { center: draft.center, radiusM: draft.radiusM, at: draft.lastSeenAt },
      context.now,
    )
  }
  return contactErrors(draft, context)
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
