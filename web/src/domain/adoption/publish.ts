// docs/product/06 · `adoption_case`: what the listing form asks and checks.
// Pre-checks for feedback; the server decides.
import type { Point } from '../shared/geo'
import type { PhoneRules } from '../shared/phone'
import {
  type AnimalDraft,
  animalErrors,
  type ContactDraft,
  contactErrors,
  DEFAULT_RADIUS_M,
  type DraftError,
  emptyAnimal,
  emptyContact,
} from '../shared/publish'

export type Temperament =
  | 'good_with_kids'
  | 'good_with_cats'
  | 'good_with_dogs'
  | 'senior'
  | 'puppy'
export type RequirementFlag =
  | 'needs_yard'
  | 'no_small_children'
  | 'no_other_dogs'
  | 'indoor_only'
  | 'experienced_home'
export type HealthFlag =
  | 'chronic_condition'
  | 'special_needs'
  | 'senior'
  | 'fiv_felv'
  | 'mobility_aid'
  | 'behavioral_support'
export type ListerRole = 'owner' | 'custodian'

export const TEMPERAMENTS: readonly Temperament[] = [
  'good_with_kids',
  'good_with_cats',
  'good_with_dogs',
  'senior',
  'puppy',
]
export const REQUIREMENT_FLAGS: readonly RequirementFlag[] = [
  'needs_yard',
  'no_small_children',
  'no_other_dogs',
  'indoor_only',
  'experienced_home',
]
export const HEALTH_FLAGS: readonly HealthFlag[] = [
  'chronic_condition',
  'special_needs',
  'senior',
  'fiv_felv',
  'mobility_aid',
  'behavioral_support',
]

export type AdoptionDraft = AnimalDraft &
  ContactDraft & {
    listerRole: ListerRole | null
    healthFlags: HealthFlag[]
    story: string
    temperament: Temperament[]
    requirementFlags: RequirementFlag[]
    requirements: string
    center: Point | null
    radiusM: number
    externalUrl: string
  }

export const emptyAdoptionDraft: AdoptionDraft = {
  ...emptyAnimal,
  ...emptyContact,
  listerRole: null,
  healthFlags: [],
  story: '',
  temperament: [],
  requirementFlags: [],
  requirements: '',
  center: null,
  radiusM: DEFAULT_RADIUS_M,
  externalUrl: '',
}

export type AdoptionDraftError =
  | DraftError
  | 'role_required'
  | 'story_required'
  | 'external_url_invalid'

export const isWebUrl = (value: string) => /^https?:\/\/\S+\.\S+/.test(value.trim())

export type AdoptionStep = 1 | 2 | 3

type Context = { phoneRules: PhoneRules | null; verifiedPhone: string | null; converting: boolean }

/**
 * 1 · who is looking for a home (name and photo: a listing is a person's post about one animal),
 * 2 · their story and the home they need, 3 · where they are and how to reach the lister.
 */
export function adoptionStepErrors(
  step: AdoptionStep,
  draft: AdoptionDraft,
  context: Context,
): AdoptionDraftError[] {
  if (step === 1) {
    const errors: AdoptionDraftError[] = animalErrors(draft, { name: true, photo: true })
    // A converted stray keeps its custodian link: the question only applies to a new pet row.
    if (!context.converting && !draft.listerRole) errors.push('role_required')
    return errors
  }
  if (step === 2) {
    return draft.story.trim() ? [] : ['story_required']
  }
  const errors: AdoptionDraftError[] = []
  if (!draft.center) errors.push('place_required')
  if (draft.externalUrl.trim() && !isWebUrl(draft.externalUrl)) errors.push('external_url_invalid')
  return [...errors, ...contactErrors(draft, context)]
}

/** What a found case hands the listing (05 · «Publicar en adopción»): photos, traits, the place. */
export function draftFromFound(found: {
  pet: Pick<AnimalDraft, 'species' | 'size' | 'colors' | 'photoUrls'> & { marks: string | null }
  center: Point
  radiusM: number
  story: string
}): AdoptionDraft {
  return {
    ...emptyAdoptionDraft,
    species: found.pet.species,
    size: found.pet.size,
    colors: found.pet.colors,
    marks: found.pet.marks ?? '',
    photoUrls: found.pet.photoUrls,
    listerRole: 'custodian',
    story: found.story,
    center: found.center,
    radiusM: found.radiusM,
  }
}
