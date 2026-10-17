// UI copy helpers for the lost case: they turn domain values into words. The rules live in
// src/domain/lost; the words in the `lost` namespace of src/i18n/locales.
import type { LostCase } from '@contracts/case'
import type { SightingError } from '@domain/lost/sightings'
import type { Translator } from '@i18n/translate'

/** «Perro · Pequeño · Negro y canela» */
export function describePet(
  i18n: Translator,
  pet: Pick<LostCase['pet'], 'species' | 'size' | 'colors'>,
): string {
  const { t } = i18n
  const species =
    pet.species === 'other' ? t('lost.pet.species_other') : t(`pet.species.${pet.species}`)
  const colors = i18n.list(pet.colors.map((color) => t(`pet.colors_in_text.${color}`)))
  const parts = [species, pet.size && t(`pet.size.${pet.size}`), capitalise(i18n, colors)]
  return parts.filter(Boolean).join(' · ')
}

const capitalise = (i18n: Translator, text: string) =>
  text.charAt(0).toLocaleUpperCase(i18n.locale) + text.slice(1)

export const formatDayMonth = (i18n: Translator, date: Date) =>
  i18n.date(date, { day: 'numeric', month: 'long' })

/** «Hoy 9:40 a. m.» · «Ayer 6:30 p. m.» · «2 oct 4:10 p. m.» — the absolute half of a sighting's time. */
export function formatSeenAt(i18n: Translator, seenAt: Date, now: Date): string {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const day = 24 * 3_600_000
  const time = i18n.date(seenAt, { hour: 'numeric', minute: '2-digit', hour12: true })
  if (seenAt.getTime() >= startOfToday) return i18n.t('time.today_at', { time })
  if (seenAt.getTime() >= startOfToday - day) return i18n.t('time.yesterday_at', { time })
  const date = i18n.date(seenAt, { day: 'numeric', month: 'short' })
  return i18n.t('lost.timeline.seen_on', { date, time })
}

export const sightingsCount = (i18n: Translator, count: number) =>
  i18n.t('lost.page.sightings_count', { count })

/** The wording docs/product/04 fixes for each rule a sighting can break. */
export const sightingErrorCopy = (i18n: Translator, error: SightingError, petName: string) =>
  i18n.t(`lost_forms.sighting_form.errors.${error}`, { name: petName })
