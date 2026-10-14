// UI copy keys for the found case. Keys only — the words live in src/i18n/locales, the rules in
// src/domain/found.
import type { FoundCase } from '@contracts/found'
import type { EvidenceTier } from '@domain/found/evidence'
import type { FoundStatus } from '@domain/found/machine'
import type { TextKey, Translator } from '@i18n/translate'

/** «Gato negro, pequeño» — a found animal has no name, so it is titled by what it looks like. */
export function describeFound(i18n: Translator, pet: FoundCase['pet']): string {
  const { t } = i18n
  const species = t(`found.describe.species.${pet.species}`)
  const colour = pet.colors[0]
  const what = colour
    ? t('found.describe.with_color', { species, color: t(`pet.colors_in_text.${colour}`) })
    : species
  const title = pet.size
    ? t('found.describe.with_size', { what, size: t(`found.describe.size.${pet.size}`) })
    : what
  // A title starts with a capital whichever word the language puts first.
  return title.charAt(0).toLocaleUpperCase(i18n.locale) + title.slice(1)
}

/** Public: tells an owner what urgency to expect (docs/product/05 · found_case). */
export const holdingLabel: Record<FoundCase['holdingWhere'], TextKey> = {
  home: 'found.holding.home',
  vet: 'found.holding.vet',
  street_temporary: 'found.holding.street_temporary',
  no_longer_held: 'found.holding.no_longer_held',
}

export const closedBand: Record<Exclude<FoundStatus, 'active' | 'expired'>, TextKey> = {
  reunited: 'found.band.reunited',
  kept: 'found.band.kept',
  converted: 'found.band.converted',
  transferred_to_org: 'found.band.transferred_to_org',
  cancelled: 'found.band.cancelled',
}

/** The label a custodian reads on a claim: how hard its evidence is to fake. */
export const tierLabel: Record<EvidenceTier, TextKey> = {
  prior_lost_case: 'found.tier.prior_lost_case',
  described: 'found.tier.described',
  documented: 'found.tier.documented',
  none: 'found.tier.none',
}
