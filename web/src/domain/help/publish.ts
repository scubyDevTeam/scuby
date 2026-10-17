// docs/product/07 · Publishing: the pet, the needs, where — then story, photos and the phone step.
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
import { defaultTarget, MAX_NEEDS, type NeedKind } from './needs'

export type NeedDraft = {
  kind: NeedKind
  /** Required: «2 semanas mientras se recupera» · «De Envigado a Laureles, martes 8 a. m.». */
  detail: string
  /** As typed; empty = «lo que puedan». */
  target: string
  /** `YYYY-MM-DD`, or empty when no date matters. */
  neededBy: string
}

export type HelpDraft = AnimalDraft &
  ContactDraft & {
    /** One of the beneficiary's pets, or null to describe it here. */
    petId: string | null
    /** A found case the beneficiary holds: its animal, already described. */
    fromCaseCode: string | null
    needs: NeedDraft[]
    story: string
    /** The request's own evidence (a vet note): optional, never of a person. */
    evidenceUrls: string[]
    center: Point | null
    radiusM: number
  }

export const emptyHelpDraft: HelpDraft = {
  ...emptyAnimal,
  ...emptyContact,
  petId: null,
  fromCaseCode: null,
  needs: [],
  story: '',
  evidenceUrls: [],
  center: null,
  radiusM: DEFAULT_RADIUS_M,
}

export const newNeed = (kind: NeedKind): NeedDraft => ({
  kind,
  detail: '',
  target: defaultTarget[kind] === null ? '' : String(defaultTarget[kind]),
  neededBy: '',
})

export type HelpDraftError =
  | DraftError
  | 'needs_required'
  | 'too_many_needs'
  | 'need_detail_required'
  | 'need_target_invalid'
  | 'needed_by_past'
  | 'story_required'

export type HelpStep = 1 | 2 | 3

/** A whole number above zero, or empty. */
const validTarget = (typed: string) => typed.trim() === '' || /^[1-9]\d{0,2}$/.test(typed.trim())

/** The needs step. Each need's own problems are reported once, for the first need that has them. */
export function needErrors(needs: readonly NeedDraft[], today: string): HelpDraftError[] {
  const errors: HelpDraftError[] = []
  if (needs.length === 0) errors.push('needs_required')
  if (needs.length > MAX_NEEDS) errors.push('too_many_needs')
  if (needs.some((n) => !n.detail.trim())) errors.push('need_detail_required')
  if (needs.some((n) => !validTarget(n.target))) errors.push('need_target_invalid')
  if (needs.some((n) => n.neededBy !== '' && n.neededBy < today)) errors.push('needed_by_past')
  return errors
}

type Context = { today: string; phoneRules: PhoneRules | null; verifiedPhone: string | null }

/** What stops a step from continuing, in the order the form shows it. */
export function helpStepErrors(
  step: HelpStep,
  draft: HelpDraft,
  context: Context,
): HelpDraftError[] {
  if (step === 1) {
    // An existing pet is already described; a new one needs what identifies it.
    return draft.petId || draft.fromCaseCode
      ? []
      : animalErrors(draft, { name: true, photo: false })
  }
  if (step === 2) return needErrors(draft.needs, context.today)
  const errors: HelpDraftError[] = []
  if (!draft.center) errors.push('place_required')
  if (!draft.story.trim()) errors.push('story_required')
  return [...errors, ...contactErrors(draft, context)]
}

/** The target as the wire wants it: a number, or null for «lo que puedan». */
export const targetOf = (need: NeedDraft): number | null =>
  need.target.trim() === '' ? null : Number(need.target.trim())
