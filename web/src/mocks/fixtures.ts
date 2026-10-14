// The emulated backend's starting rows: one lost case per status, two found cases, one card of
// every other vertical. Dates are relative to "now" so «hace 2 h» stays true whenever it is opened.
import type { api, WireOf } from '../contracts/api'
import { mockPhoto } from './photo'
import { DAY, HOUR, iso } from './rules'
import { caseView, feedView } from './serialize'
import type { CaseRow, PersonRow, SightingRow, Tables } from './tables'

/** The account «Continuar con Google» signs into: it owns Luna and holds a found dog. */
export const DEMO_OWNER_ID = 'user-carolina'

const ago = (ms: number) => iso(Date.now() - ms)

const laureles = { lat: 6.2447, lng: -75.5916 }
const offset = (north: number, east: number) => ({
  lat: laureles.lat + north / 111_320,
  lng: laureles.lng + east / 110_650,
})

const everyJourney = { lost: true, found: true, adoption: true, help: true }
const person = (id: string, display_name: string, email: string): PersonRow => ({
  id,
  display_name,
  email,
  phone: null,
  city: 'Medellín',
  bio: null,
  notification_prefs: everyJourney,
})

const exposeWhatsapp = { expose_whatsapp: true, expose_email: false, in_app_only: false }

function sighting(
  id: string,
  caseCode: string,
  fields: Partial<SightingRow> & Pick<SightingRow, 'point' | 'seen_at'>,
): SightingRow {
  return {
    id,
    case_code: caseCode,
    species: null,
    created_at: fields.seen_at,
    note: null,
    photo_urls: [],
    reporter_id: null,
    reporter_key: `device-${id}`,
    contact_phone: null,
    status: 'visible',
    highlighted_by_owner: false,
    ...fields,
  }
}

function closedLost(
  code: string,
  name: string,
  status: 'reunited' | 'expired' | 'cancelled',
  resolvedAgo: number,
  resolution: string,
): CaseRow {
  return {
    code,
    vertical: 'lost',
    status,
    pet_id: `pet-${name.toLowerCase()}`,
    created_by: 'user-julian',
    published_at: ago(resolvedAgo + 7 * DAY),
    resolved_at: ago(resolvedAgo),
    resolution,
    resolution_attribution: status === 'reunited' ? 'platform_sighting' : null,
    contact_prefs: exposeWhatsapp,
    contact_phone: '+573000000003',
    phone_has_whatsapp: true,
    last_seen: {
      center: offset(400, -300),
      radius_m: 300,
      at: ago(resolvedAgo + 7 * DAY),
      place_name: 'Laureles',
    },
  }
}

export function seed(): Tables {
  const cases: CaseRow[] = [
    {
      code: '7K3PQ',
      vertical: 'lost',
      status: 'active',
      pet_id: 'pet-luna',
      created_by: DEMO_OWNER_ID,
      published_at: ago(2 * DAY),
      resolved_at: null,
      resolution: null,
      resolution_attribution: null,
      contact_prefs: exposeWhatsapp,
      contact_phone: '+573000000000',
      phone_has_whatsapp: true,
      // 100 m as the owner drew it: the page must render it at the 200 m public floor.
      last_seen: { center: laureles, radius_m: 100, at: ago(2 * DAY), place_name: 'Laureles' },
    },
    {
      code: 'M2TQ4',
      vertical: 'lost',
      status: 'active',
      pet_id: 'pet-milo',
      created_by: 'user-julian',
      published_at: ago(DAY),
      resolved_at: null,
      resolution: null,
      resolution_attribution: null,
      contact_prefs: exposeWhatsapp,
      contact_phone: '+573000000003',
      phone_has_whatsapp: true,
      last_seen: { center: offset(-1500, -1400), radius_m: 300, at: ago(DAY), place_name: 'Belén' },
    },
    closedLost('H4PPY', 'Toby', 'reunited', 3 * DAY, 'reunited_home'),
    closedLost('ARCH2', 'Kira', 'expired', 5 * DAY, 'no_response'),
    closedLost('CANC3', 'Rocky', 'cancelled', DAY, 'false_alarm'),
    {
      code: 'F8UND',
      vertical: 'found',
      status: 'active',
      pet_id: 'pet-found-cat',
      created_by: 'user-marcela',
      published_at: ago(5 * HOUR),
      resolved_at: null,
      resolution: null,
      resolution_attribution: null,
      contact_prefs: exposeWhatsapp,
      contact_phone: '+573000000002',
      phone_has_whatsapp: true,
      // 100 m as drawn: the page floors it at 200 m — the custodian's home is where it is now.
      found: { center: offset(-1900, -900), radius_m: 100, at: ago(5 * HOUR), place_name: 'Belén' },
      holding_where: 'home',
      held_since: ago(5 * HOUR),
      hold_offer_at: ago(5 * HOUR - 15 * DAY),
      withheld_detail: 'Mancha blanca en la pata trasera izquierda',
      org_name: null,
    },
    {
      // Held 16 days with nobody confirmed: the day-15 offer shows. Its custodian is the demo account.
      code: 'C4STD',
      vertical: 'found',
      status: 'active',
      pet_id: 'pet-found-dog',
      created_by: DEMO_OWNER_ID,
      published_at: ago(16 * DAY),
      resolved_at: null,
      resolution: null,
      resolution_attribution: null,
      contact_prefs: exposeWhatsapp,
      contact_phone: '+573000000000',
      phone_has_whatsapp: true,
      found: {
        center: offset(1400, -600),
        radius_m: 300,
        at: ago(16 * DAY),
        place_name: 'Estadio',
      },
      holding_where: 'home',
      held_since: ago(16 * DAY),
      hold_offer_at: ago(DAY),
      withheld_detail: 'Collar verde con una campana',
      org_name: null,
    },
    {
      code: 'AD9PT',
      vertical: 'adoption',
      status: 'active',
      title: 'Nube',
      species: 'cat',
      place_name: 'Estadio',
      point: offset(900, 1500),
      photo_url: mockPhoto('#b9c4cf'),
      published_at: ago(3 * DAY),
      detail: 'Sin cuota',
    },
    {
      code: 'HE7PA',
      vertical: 'help',
      status: 'active',
      title: 'Max · cirugía de cadera',
      species: 'dog',
      place_name: 'Envigado',
      point: offset(-7800, 900),
      photo_url: mockPhoto('#b98a3e'),
      published_at: ago(4 * DAY),
      detail: '14 personas ayudaron',
    },
  ]

  return {
    persons: [
      person(DEMO_OWNER_ID, 'Carolina Mejía', 'carolina@correo.co'),
      person('user-marcela', 'Marcela Torres', 'marcela@correo.co'),
      person('user-julian', 'Julián Restrepo', 'julian@correo.co'),
      { ...person('user-andres', 'Andrés Rojas', 'andres@correo.co'), phone: '+573000000001' },
    ],
    pets: [
      {
        id: 'pet-luna',
        owner_id: DEMO_OWNER_ID,
        name: 'Luna',
        species: 'dog',
        size: 'small',
        colors: ['black' as const, 'tan' as const],
        marks:
          'Collar rojo con placa metálica. Mancha blanca en el pecho. Es tímida: no la persigas, llámala por su nombre y agáchate.',
        chip_number: null,
        photo_urls: [
          mockPhoto('#3b2f2f'),
          mockPhoto('#5a4636'),
          mockPhoto('#2f2a26'),
          mockPhoto('#6b5444'),
        ],
      },
      {
        id: 'pet-milo',
        owner_id: 'user-julian',
        name: 'Milo',
        species: 'cat',
        size: 'small',
        colors: ['orange' as const],
        marks: null,
        chip_number: null,
        photo_urls: [mockPhoto('#c9772f')],
      },
      ...['Toby', 'Kira', 'Rocky'].map((name) => ({
        id: `pet-${name.toLowerCase()}`,
        owner_id: 'user-julian',
        name,
        species: 'dog' as const,
        size: 'small' as const,
        colors: ['brown' as const],
        marks: null,
        chip_number: null,
        photo_urls: [mockPhoto('#7a5c3e')],
      })),
      {
        id: 'pet-found-cat',
        owner_id: null,
        name: null,
        species: 'cat',
        size: 'small',
        colors: ['black'],
        marks: 'Ojos azules. Se deja cargar.',
        chip_number: null,
        photo_urls: [mockPhoto('#22252b')],
      },
      {
        id: 'pet-found-dog',
        owner_id: null,
        name: null,
        species: 'dog',
        size: 'medium',
        colors: ['brown'],
        marks: 'Muy manso, sabe sentarse.',
        chip_number: null,
        photo_urls: [mockPhoto('#8a6a4a')],
      },
    ],
    cases: Object.fromEntries(cases.map((row) => [row.code, row])),
    purged: ['GONE5'],
    sightings: [
      sighting('s1', '7K3PQ', {
        point: offset(-90, -80),
        seen_at: ago(2 * DAY - 2 * HOUR),
        note: 'Corría asustada por la 70',
      }),
      sighting('s2', '7K3PQ', {
        point: offset(60, 240),
        seen_at: ago(17 * HOUR),
        contact_phone: '+573156677889',
      }),
      sighting('s3', '7K3PQ', {
        point: offset(260, 310),
        seen_at: ago(2 * HOUR),
        note: 'Iba hacia el parque, con collar rojo',
        photo_urls: [mockPhoto('#3b2f2f')],
        reporter_id: 'user-andres',
        contact_phone: '+573000000001',
      }),
    ],
    recoveryClaims: [
      {
        id: 'claim-luna',
        case_code: '7K3PQ',
        phone: '+573114829017',
        claimant_id: null,
        created_at: ago(3 * HOUR),
        status: 'open',
        stale_at: ago(3 * HOUR - 7 * DAY),
      },
    ],
    ownershipClaims: [
      {
        id: 'own-1',
        case_code: 'C4STD',
        claimant_id: 'user-andres',
        created_at: ago(5 * HOUR),
        status: 'open',
        evidence_notes: 'Tiene un collar verde con campanita',
        chip_number: null,
        photo_urls: [],
        from_lost_case_code: null,
      },
    ],
    checkins: [
      // Luna's own clock: the first «¿sigue perdida?» at +72 h, and the claim's at +24 h and +72 h.
      checkin('ck-luna-1', '7K3PQ', null, 'time_based', ago(2 * DAY - 72 * HOUR)),
      checkin('ck-luna-claim-1', '7K3PQ', 'claim-luna', 'post_recovery_claim', ago(3 * HOUR - DAY)),
      checkin(
        'ck-luna-claim-2',
        '7K3PQ',
        'claim-luna',
        'post_recovery_claim',
        ago(3 * HOUR - 3 * DAY),
      ),
      // Milo's first check-in fell due an hour ago: his owner has a question waiting.
      checkin('ck-milo-1', 'M2TQ4', null, 'time_based', ago(HOUR)),
    ],
    notifications: [
      {
        id: 'n-1',
        person_id: DEMO_OWNER_ID,
        event: 'recovery_claim.opened',
        body: 'Alguien dice que tiene a Luna. Ábrelo para contactar.',
        case_code: '7K3PQ',
        created_at: ago(3 * HOUR),
        read_at: null,
      },
      {
        id: 'n-2',
        person_id: DEMO_OWNER_ID,
        event: 'ownership_claim.opened',
        body: 'Alguien dice ser el dueño. Ábrelo para ver lo que envió.',
        case_code: 'C4STD',
        created_at: ago(5 * HOUR),
        read_at: null,
      },
      {
        id: 'n-3',
        person_id: DEMO_OWNER_ID,
        event: 'lost_case.broadcast_sent',
        body: 'Tu aviso de Luna ya llegó a los vecinos de la zona.',
        case_code: '7K3PQ',
        created_at: ago(2 * DAY),
        read_at: ago(2 * DAY),
      },
    ],
    pushSubscriptions: [],
    reports: [],
    nextId: 1,
  }
}

function checkin(
  id: string,
  caseCode: string,
  claimId: string | null,
  trigger: 'time_based' | 'post_recovery_claim',
  scheduledAt: string,
) {
  return {
    id,
    case_code: caseCode,
    claim_id: claimId,
    trigger,
    scheduled_at: scheduledAt,
    responded_at: null,
    cancelled_at: null,
    response: null,
  }
}

type CaseWire = WireOf<typeof api.getCase>
type FeedItemWire = WireOf<typeof api.getFeed>['items'][number]

/**
 * Every seeded case as a stranger opening its link gets it — or, with `responsible`, as the person
 * who published it does: claims, hidden pins, the withheld detail. For tests.
 */
export function cases(viewer: 'public' | 'responsible' = 'public'): Record<string, CaseWire> {
  const tables = seed()
  return Object.fromEntries(
    Object.values(tables.cases).map((row) => [
      row.code,
      caseView(
        tables,
        row,
        viewer === 'responsible' && 'created_by' in row ? row.created_by : null,
      ),
    ]),
  )
}

/** The seeded feed, as a stranger in Medellín gets it. For tests. */
export function feedItems(): FeedItemWire[] {
  return feedView(seed(), null).items
}
