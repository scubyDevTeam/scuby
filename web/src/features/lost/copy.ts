// Spanish UI copy for the lost case. Strings only — the rules live in src/domain/lost.
import type { LostCase } from '@contracts/case'

const speciesLabel = { dog: 'Perro', cat: 'Gato', other: 'Mascota' } as const
const sizeLabel = { small: 'Pequeño', medium: 'Mediano', large: 'Grande' } as const

/** «Perro · Pequeño · Negro y canela» */
export function describePet(pet: LostCase['pet']): string {
  const colors = pet.colors.join(' y ')
  const parts = [speciesLabel[pet.species], pet.size && sizeLabel[pet.size], colors]
  return parts.filter(Boolean).join(' · ')
}

const dayMonth = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'long' })
const shortDayMonth = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' })
const clock = new Intl.DateTimeFormat('es', { hour: 'numeric', minute: '2-digit', hour12: true })

export const formatDayMonth = (date: Date) => dayMonth.format(date)

/** «Hoy 9:40 a. m.» · «Ayer 6:30 p. m.» · «2 oct 4:10 p. m.» — the absolute half of a sighting's time. */
export function formatSeenAt(seenAt: Date, now: Date): string {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const day = 24 * 3_600_000
  const time = clock.format(seenAt)
  if (seenAt.getTime() >= startOfToday) return `Hoy ${time}`
  if (seenAt.getTime() >= startOfToday - day) return `Ayer ${time}`
  return `${shortDayMonth.format(seenAt)} ${time}`
}

export function sightingsCount(count: number): string {
  return count === 1 ? '1 avistamiento' : `${count} avistamientos`
}
