// Spanish UI copy for the found case. Strings only — the rules live in src/domain/found.
import type { FoundCase } from '@contracts/found'
import type { EvidenceTier } from '@domain/found/evidence'
import type { FoundStatus } from '@domain/found/machine'

const speciesLabel = { dog: 'Perro', cat: 'Gato', other: 'Animal' } as const
const sizeLabel = { small: 'pequeño', medium: 'mediano', large: 'grande' } as const

/** «Gato negro, pequeño» — a found animal has no name, so it is titled by what it looks like. */
export function describeFound(pet: FoundCase['pet']): string {
  const colour = pet.colors[0]?.toLowerCase()
  const what = [speciesLabel[pet.species], colour].filter(Boolean).join(' ')
  return [what, pet.size && sizeLabel[pet.size]].filter(Boolean).join(', ')
}

/** Public: tells an owner what urgency to expect (docs/product/05 · found_case). */
export const holdingLabel: Record<FoundCase['holdingWhere'], string> = {
  home: 'Está en casa de quien lo encontró',
  vet: 'Está en una veterinaria',
  street_temporary: 'Sigue en la calle, lo están cuidando',
  no_longer_held: 'Ya no lo tienen: se fue de nuevo',
}

export const closedBand: Record<Exclude<FoundStatus, 'active' | 'expired'>, string> = {
  reunited: 'Ya está con su familia',
  kept: 'Ya tiene hogar',
  converted: 'Ahora está en adopción',
  transferred_to_org: 'Está con una fundación',
  cancelled: 'Aviso cerrado',
}

/** The label a custodian reads on a claim: how hard its evidence is to fake. */
export const tierLabel: Record<EvidenceTier, string> = {
  prior_lost_case: '⭐ Publicó un aviso de perdido antes de que lo encontraras',
  described: 'Describió algo que no sale en las fotos',
  documented: 'Adjuntó microchip o documentos',
  none: '⚠️ Sin evidencia',
}

export const SAFETY_COPY =
  'Antes de entregarlo, pide el dato que guardaste, una foto anterior o el carnet de vacunas. Entrégalo en un lugar público.'
