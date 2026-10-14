// docs/product/05 · Publishing: what the found form and the witness report ask and check.
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

export type HoldingWhere = 'home' | 'vet' | 'street_temporary'

export type FoundDraft = AnimalDraft &
  ContactDraft & {
    center: Point | null
    radiusM: number
    foundAt: Date | null
    holdingWhere: HoldingWhere
    /** The shibboleth: one detail kept out of the public post, for telling the real owner apart. */
    withheldDetail: string
  }

export const emptyFoundDraft: FoundDraft = {
  ...emptyAnimal,
  ...emptyContact,
  // A custodian may reasonably stay in-app until a claimant earns trust.
  contact: { whatsapp: false, email: false, inApp: true },
  center: emptyArea.center,
  radiusM: emptyArea.radiusM,
  foundAt: null,
  holdingWhere: 'home',
  withheldDetail: '',
}

export type FoundStep = 1 | 2 | 3

type Context = { now: Date; phoneRules: PhoneRules | null; verifiedPhone: string | null }

/** A found animal has no name to give, and without a photo nobody can recognise it. */
export function foundStepErrors(
  step: FoundStep,
  draft: FoundDraft,
  context: Context,
): DraftError[] {
  if (step === 1) return animalErrors(draft, { name: false, photo: true })
  if (step === 2) {
    return areaErrors(
      { center: draft.center, radiusM: draft.radiusM, at: draft.foundAt },
      context.now,
    )
  }
  return contactErrors(draft, context)
}

export type WitnessDraft = {
  photoUrls: string[]
  species: AnimalDraft['species']
  point: Point | null
  seenAt: Date | null
}

/**
 * «No lo tengo, solo lo vi»: pin and photo required — with no case for context, a report without a
 * photo cannot be matched to anything. Contact stays optional.
 */
export function witnessErrors(draft: WitnessDraft, now: Date): DraftError[] {
  const errors: DraftError[] = []
  if (draft.photoUrls.length === 0) errors.push('photo_required')
  if (!draft.species) errors.push('species_required')
  if (!draft.point) errors.push('place_required')
  if (!draft.seenAt) errors.push('time_required')
  else if (draft.seenAt.getTime() > now.getTime()) errors.push('time_in_the_future')
  return errors
}
