// What the real backend computes for the client, done the simple way: distances, place names,
// how a person is named in public, the titles of cards.
import type { Color, Point } from '../contracts/primitives'

export const HOUR = 3_600_000
export const DAY = 24 * HOUR

export const now = () => new Date()
export const iso = (date: Date | number) => new Date(date).toISOString()
export const ms = (timestamp: string) => new Date(timestamp).getTime()

export function metres(a: Point, b: Point): number {
  return Math.hypot(
    (a.lat - b.lat) * 110_574,
    (a.lng - b.lng) * 111_320 * Math.cos((a.lat * Math.PI) / 180),
  )
}

// Geocoding stand-in: the nearest of a few Medellín neighbourhoods. The real backend reverse-geocodes.
const PLACES: [string, Point][] = [
  ['Laureles', { lat: 6.2447, lng: -75.5916 }],
  ['Belén', { lat: 6.2276, lng: -75.5998 }],
  ['Estadio', { lat: 6.2573, lng: -75.5971 }],
  ['El Poblado', { lat: 6.2088, lng: -75.5674 }],
  ['Envigado', { lat: 6.1745, lng: -75.5832 }],
  ['Robledo', { lat: 6.2775, lng: -75.6033 }],
  ['Buenos Aires', { lat: 6.2392, lng: -75.5524 }],
  ['Centro', { lat: 6.2518, lng: -75.5636 }],
]

export function placeName(point: Point): string {
  let best = PLACES[0] as [string, Point]
  for (const place of PLACES) if (metres(point, place[1]) < metres(point, best[1])) best = place
  return best[0]
}

/** «Carolina Mejía» → «Carolina M.»: the public face of a publisher. */
export function publicName(displayName: string): string {
  const [first = '', last] = displayName.trim().split(/\s+/)
  return last ? `${first} ${last[0]?.toUpperCase()}.` : first
}

export const whatsappUrl = (phone: string) => `https://wa.me/${phone.replace('+', '')}`

/** «juan.perez@correo.co» → «Juan Perez», until the person names themselves in the profile. */
export const nameFromEmail = (email: string) =>
  (email.split('@')[0] ?? '')
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(' ')

const SPECIES = { dog: 'Perro', cat: 'Gato', other: 'Animal' } as const
const SIZE = { small: 'pequeño', medium: 'mediano', large: 'grande' } as const
/** The server composes display text in the request's language; the emulation speaks only Spanish. */
export const COLOR: Record<Color, string> = {
  black: 'negro',
  white: 'blanco',
  brown: 'café',
  tan: 'canela',
  gray: 'gris',
  yellow: 'amarillo',
  orange: 'naranja',
}
type Look = { species: keyof typeof SPECIES; size: keyof typeof SIZE | null; colors: Color[] }

/** «Gato negro, pequeño» — a found animal has no name, so its card is titled by what it looks like. */
export function lookTitle(pet: Look): string {
  const colour = pet.colors[0] && COLOR[pet.colors[0]]
  return [[SPECIES[pet.species], colour].filter(Boolean).join(' '), pet.size && SIZE[pet.size]]
    .filter(Boolean)
    .join(', ')
}

/** «Perro · Pequeño · Negro y canela» — the line under a card's title. */
export function lookSummary(pet: Look): string {
  const size = pet.size ? SIZE[pet.size] : null
  const colours = pet.colors.map((c) => COLOR[c])
  const colourText =
    colours.length > 1 ? `${colours.slice(0, -1).join(', ')} y ${colours.at(-1)}` : colours[0]
  return [SPECIES[pet.species], size, colourText]
    .filter((part): part is string => Boolean(part))
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(' · ')
}

/** «hace 2 h», «hace 3 días» — how notifications word a time. */
export function ago(timestamp: string, from = now()): string {
  const minutes = Math.round((from.getTime() - ms(timestamp)) / 60_000)
  if (minutes < 60) return `hace ${Math.max(minutes, 1)} min`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `hace ${hours} h`
  const days = Math.round(hours / 24)
  return days === 1 ? 'ayer' : `hace ${days} días`
}

/** «a 400 m», «a 2,3 km» */
export function distance(metresAway: number): string {
  if (metresAway < 1000) return `a ${Math.round(metresAway / 50) * 50} m`
  return `a ${(metresAway / 1000).toFixed(1).replace('.', ',')} km`
}
