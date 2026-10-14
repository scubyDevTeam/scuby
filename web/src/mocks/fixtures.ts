// One fixture per status of the lost case, plus one case of every other vertical for the feed.
// Dates are relative to "now" so «hace 2 h» stays true whenever the app is opened.
import type { z } from 'zod'
import type { caseWire, lostCaseWire } from '../contracts/case'
import type { feedWire } from '../contracts/feed'
import { mockPhoto } from './photo'

type CaseWire = z.input<typeof caseWire>
type LostCaseWire = z.input<typeof lostCaseWire>
type FeedItemWire = z.input<typeof feedWire>['items'][number]

const HOUR = 3_600_000
const DAY = 24 * HOUR
const ago = (ms: number) => new Date(Date.now() - ms).toISOString()

const laureles = { lat: 6.2447, lng: -75.5916 }
const offset = (north: number, east: number) => ({
  lat: laureles.lat + north / 111_320,
  lng: laureles.lng + east / 110_650,
})

function luna(): LostCaseWire {
  return {
    code: '7K3PQ',
    vertical: 'lost',
    status: 'active',
    resolved_at: null,
    viewer: 'public',
    pet: {
      name: 'Luna',
      species: 'dog',
      size: 'small',
      colors: ['Negro', 'canela'],
      marks:
        'Collar rojo con placa metálica. Mancha blanca en el pecho. Es tímida: no la persigas, llámala por su nombre y agáchate.',
      photo_urls: [
        mockPhoto('#3b2f2f'),
        mockPhoto('#5a4636'),
        mockPhoto('#2f2a26'),
        mockPhoto('#6b5444'),
      ],
    },
    // 100 m as the owner drew it: the page must render it at the 200 m public floor.
    last_seen: { center: laureles, radius_m: 100, at: ago(2 * DAY), place_name: 'Laureles' },
    open_claim_count: 1,
    sightings: [
      {
        id: 's1',
        point: offset(-90, -80),
        seen_at: ago(2 * DAY - 2 * HOUR),
        note: 'Corría asustada por la 70',
        photo_url: null,
        source: 'anonymous',
        highlighted_by_owner: false,
      },
      {
        id: 's2',
        point: offset(60, 240),
        seen_at: ago(17 * HOUR),
        note: null,
        photo_url: null,
        source: 'anonymous',
        highlighted_by_owner: false,
      },
      {
        id: 's3',
        point: offset(260, 310),
        seen_at: ago(2 * HOUR),
        note: 'Iba hacia el parque, con collar rojo',
        photo_url: mockPhoto('#3b2f2f'),
        source: 'registered',
        highlighted_by_owner: false,
      },
    ],
    contact: { display_name: 'Carolina M.', whatsapp_url: 'https://wa.me/573000000000' },
  }
}

function closedLost(
  code: string,
  name: string,
  status: 'reunited' | 'expired' | 'cancelled',
  resolvedAgo: number,
): LostCaseWire {
  return {
    ...luna(),
    code,
    status,
    resolved_at: ago(resolvedAgo),
    pet: { ...luna().pet, name, photo_urls: [mockPhoto('#7a5c3e')] },
    open_claim_count: 0,
    sightings: [],
    contact: null,
  }
}

export function cases(): Record<string, CaseWire> {
  const all: CaseWire[] = [
    luna(),
    {
      ...luna(),
      code: 'M2TQ4',
      open_claim_count: 0,
      sightings: [],
      pet: {
        ...luna().pet,
        name: 'Milo',
        species: 'cat',
        colors: ['Naranja'],
        marks: null,
        photo_urls: [mockPhoto('#c9772f')],
      },
      last_seen: { ...luna().last_seen, at: ago(DAY), radius_m: 300, place_name: 'Belén' },
    },
    closedLost('H4PPY', 'Toby', 'reunited', 3 * DAY),
    closedLost('ARCH2', 'Kira', 'expired', 5 * DAY),
    closedLost('CANC3', 'Rocky', 'cancelled', DAY),
    {
      code: 'F8UND',
      vertical: 'found',
      status: 'active',
      title: 'Gato negro, pequeño',
      place_name: 'Belén',
      photo_url: mockPhoto('#22252b'),
    },
    {
      code: 'AD9PT',
      vertical: 'adoption',
      status: 'active',
      title: 'Nube',
      place_name: 'Estadio',
      photo_url: mockPhoto('#b9c4cf'),
    },
    {
      code: 'HE7PA',
      vertical: 'help',
      status: 'active',
      title: 'Max · cirugía de cadera',
      place_name: 'Envigado',
      photo_url: mockPhoto('#b98a3e'),
    },
  ]
  return Object.fromEntries(all.map((c) => [c.code, c]))
}

/** Codes that existed and were purged: the page says so instead of 404ing a printed poster. */
export const purgedCodes = new Set(['GONE5'])

export function feedItems(): FeedItemWire[] {
  return [
    {
      code: '7K3PQ',
      vertical: 'lost',
      title: 'Luna',
      species: 'dog',
      summary: 'Perra · Pequeña · Negro y canela',
      place_name: 'Laureles',
      point: laureles,
      photo_url: mockPhoto('#3b2f2f'),
      happened_at: ago(2 * DAY),
      possible_find: true,
      sightings_count: 3,
      last_sighting_at: ago(2 * HOUR),
      detail: null,
    },
    {
      code: 'F8UND',
      vertical: 'found',
      title: 'Gato negro, pequeño',
      species: 'cat',
      summary: null,
      place_name: 'Belén',
      point: offset(-1900, -900),
      photo_url: mockPhoto('#22252b'),
      happened_at: ago(5 * HOUR),
      possible_find: false,
      sightings_count: null,
      last_sighting_at: null,
      detail: null,
    },
    {
      code: 'AD9PT',
      vertical: 'adoption',
      title: 'Nube',
      species: 'cat',
      summary: null,
      place_name: 'Estadio',
      point: offset(900, 1500),
      photo_url: mockPhoto('#b9c4cf'),
      happened_at: ago(3 * DAY),
      possible_find: false,
      sightings_count: null,
      last_sighting_at: null,
      detail: 'Sin cuota',
    },
    {
      code: 'HE7PA',
      vertical: 'help',
      title: 'Max · cirugía de cadera',
      species: 'dog',
      summary: null,
      place_name: 'Envigado',
      point: offset(-7800, 900),
      photo_url: mockPhoto('#b98a3e'),
      happened_at: ago(4 * DAY),
      possible_find: false,
      sightings_count: null,
      last_sighting_at: null,
      detail: '14 personas ayudaron',
    },
    {
      code: 'M2TQ4',
      vertical: 'lost',
      title: 'Milo',
      species: 'cat',
      summary: 'Gato · Naranja',
      place_name: 'Belén',
      point: offset(-1500, -1400),
      photo_url: mockPhoto('#c9772f'),
      happened_at: ago(DAY),
      possible_find: false,
      sightings_count: 0,
      last_sighting_at: null,
      detail: null,
    },
  ]
}
