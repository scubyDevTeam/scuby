// The emulated backend's starting rows: one lost case per status, found cases (one converted into
// an adoption listing), adoption listings — open, «en proceso», adopted — and one help card. Dates are relative to "now" so «hace 2 h» stays true whenever it is opened.
import type { api, WireOf } from '../contracts/api'
import { mockPhoto } from './photo'
import { DAY, HOUR, iso } from './rules'
import { caseView, feedView } from './serialize'
import type {
  AdoptionInterestRow,
  AdoptionRow,
  CaseRow,
  PersonRow,
  PetRow,
  SightingRow,
  Tables,
} from './tables'

/** The account «Continuar con Google» signs into: it owns Luna and holds a found dog. */
export const DEMO_OWNER_ID = 'user-carolina'

const ago = (ms: number) => iso(Date.now() - ms)

const laureles = { lat: 6.2447, lng: -75.5916 }
const offset = (north: number, east: number) => ({
  lat: laureles.lat + north / 111_320,
  lng: laureles.lng + east / 110_650,
})

const everyJourney = { lost: true, found: true, adoption: true, help: true }
const person = (
  id: string,
  display_name: string,
  email: string,
  joinedAgo = 300 * DAY,
): PersonRow => ({
  id,
  display_name,
  email,
  phone: null,
  city: 'Medellín',
  bio: null,
  notification_prefs: everyJourney,
  joined_at: ago(joinedAgo),
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

const pet = (
  fields: Pick<PetRow, 'id' | 'owner_id' | 'name' | 'species' | 'size' | 'colors' | 'photo_urls'> &
    Partial<PetRow>,
): PetRow => ({
  marks: null,
  chip_number: null,
  custody_state: fields.owner_id ? 'claimed' : 'unclaimed',
  health_flags: [],
  ...fields,
})

/** An adoption listing as a person publishes it: individual, light lane, WhatsApp exposed. */
function listing(
  fields: Pick<
    AdoptionRow,
    'code' | 'pet_id' | 'created_by' | 'published_at' | 'contact_phone' | 'story' | 'location'
  > &
    Partial<AdoptionRow>,
): AdoptionRow {
  return {
    vertical: 'adoption',
    status: 'active',
    resolved_at: null,
    resolution: null,
    resolution_attribution: null,
    contact_prefs: exposeWhatsapp,
    phone_has_whatsapp: true,
    predecessor_case_code: null,
    temperament: [],
    requirement_flags: [],
    requirements: null,
    fee_cop: 0,
    fee_covers: [],
    lane: 'light',
    external_url: null,
    trust_tier: 'individual',
    ...fields,
  }
}

function interest(
  id: string,
  caseCode: string,
  personId: string,
  phone: string,
  createdAgo: number,
  fields: Partial<AdoptionInterestRow> = {},
): AdoptionInterestRow {
  return {
    id,
    case_code: caseCode,
    person_id: personId,
    kind: 'interest',
    form_data: null,
    intro: {
      housing: 'apartment',
      has_yard: false,
      other_pets: null,
      household: null,
      why: 'Trabajo desde casa y tengo tiempo para acompañarlo.',
    },
    contact_phone: phone,
    phone_has_whatsapp: true,
    status: 'open',
    created_at: ago(createdAgo),
    first_responded_at: null,
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
      successor_case_code: null,
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
      successor_case_code: null,
    },
    {
      // Twenty days unclaimed: its custodian took the day-15 offer and listed it in adoption.
      code: 'R3SCU',
      vertical: 'found',
      status: 'converted',
      pet_id: 'pet-canela',
      created_by: 'user-marcela',
      published_at: ago(20 * DAY),
      resolved_at: ago(3 * DAY),
      resolution: 'converted_to_adoptable',
      resolution_attribution: null,
      contact_prefs: exposeWhatsapp,
      contact_phone: '+573000000002',
      phone_has_whatsapp: true,
      found: {
        center: offset(-1700, -700),
        radius_m: 300,
        at: ago(20 * DAY),
        place_name: 'Belén',
      },
      holding_where: 'home',
      held_since: ago(20 * DAY),
      hold_offer_at: ago(5 * DAY),
      withheld_detail: null,
      org_name: null,
      successor_case_code: 'B3TOS',
    },
    listing({
      // Open, no fee, one person interested: the listing a stranger meets in the feed.
      code: 'AD9PT',
      pet_id: 'pet-nube',
      created_by: 'user-sofia',
      published_at: ago(3 * DAY),
      contact_phone: '+573000000005',
      story:
        'La rescaté de un techo en Estadio cuando tenía dos meses. Es tranquila, ronronea mucho y ' +
        'usa su arenero sin problema. Busca una casa donde no salga a la calle.',
      temperament: ['good_with_cats'],
      requirement_flags: ['indoor_only'],
      requirements: 'Ventanas con malla.',
      location: {
        center: offset(900, 1500),
        radius_m: 300,
        at: ago(3 * DAY),
        place_name: 'Estadio',
      },
    }),
    listing({
      // Born from R3SCU at the day-15 offer, with a fee that says what it covers. Someone was
      // chosen: «En proceso», and it ranks below the listings still waiting.
      code: 'B3TOS',
      pet_id: 'pet-canela',
      created_by: 'user-marcela',
      published_at: ago(3 * DAY - 2 * HOUR),
      contact_phone: '+573000000002',
      predecessor_case_code: 'R3SCU',
      story:
        'La encontré en Belén hace tres semanas. Nadie la reclamó. Es mayor, muy mansa y camina ' +
        'despacio: necesita a alguien con paciencia.',
      temperament: ['good_with_kids', 'good_with_dogs', 'senior'],
      requirement_flags: ['experienced_home'],
      fee_cop: 120_000,
      fee_covers: ['sterilization', 'vaccines', 'deworming'],
      location: {
        center: offset(-1700, -700),
        radius_m: 300,
        at: ago(3 * DAY),
        place_name: 'Belén',
      },
    }),
    listing({
      // The demo account's: two people interested, and «¿sigue disponible?» waiting since yesterday.
      code: 'M1SHI',
      pet_id: 'pet-misha',
      created_by: DEMO_OWNER_ID,
      published_at: ago(8 * DAY),
      contact_phone: '+573000000000',
      story: 'La encontré en el parque de Laureles. Es juguetona y se lleva bien con otros gatos.',
      temperament: ['good_with_cats', 'puppy'],
      location: {
        center: offset(200, 300),
        radius_m: 100,
        at: ago(8 * DAY),
        place_name: 'Laureles',
      },
    }),
    listing({
      // Closed: Andrés adopted him through the app, and the responsibility moved to him.
      code: 'ADPT8',
      pet_id: 'pet-simon',
      created_by: 'user-julian',
      status: 'adopted',
      resolution: 'adopted_in_app',
      published_at: ago(40 * DAY),
      resolved_at: ago(10 * DAY),
      contact_phone: '+573000000003',
      story: 'Simón es un perro grande y noble. Le encantan las caminatas largas.',
      temperament: ['good_with_kids'],
      requirement_flags: ['needs_yard'],
      location: {
        center: offset(-900, 600),
        radius_m: 300,
        at: ago(40 * DAY),
        place_name: 'Laureles',
      },
    }),
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
      person(DEMO_OWNER_ID, 'Carolina Mejía', 'carolina@correo.co', 240 * DAY),
      person('user-marcela', 'Marcela Torres', 'marcela@correo.co', 500 * DAY),
      person('user-julian', 'Julián Restrepo', 'julian@correo.co', 400 * DAY),
      {
        ...person('user-andres', 'Andrés Rojas', 'andres@correo.co', 95 * DAY),
        phone: '+573000000001',
      },
      { ...person('user-sofia', 'Sofía Vélez', 'sofia@correo.co'), phone: '+573000000005' },
      {
        ...person('user-camilo', 'Camilo Ríos', 'camilo@correo.co', 20 * DAY),
        phone: '+573000000004',
        city: 'Envigado',
      },
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
        custody_state: 'claimed',
        health_flags: [],
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
        custody_state: 'claimed',
        health_flags: [],
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
        custody_state: 'claimed' as const,
        health_flags: [],
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
        custody_state: 'unclaimed',
        health_flags: [],
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
        custody_state: 'unclaimed',
        health_flags: [],
        photo_urls: [mockPhoto('#8a6a4a')],
      },
      pet({
        id: 'pet-nube',
        owner_id: null,
        name: 'Nube',
        species: 'cat',
        size: 'small',
        colors: ['gray', 'white'],
        marks: 'Ojos verdes, una oreja con la punta blanca.',
        photo_urls: [mockPhoto('#b9c4cf')],
      }),
      pet({
        id: 'pet-canela',
        owner_id: null,
        name: 'Canela',
        species: 'dog',
        size: 'medium',
        colors: ['tan'],
        photo_urls: [mockPhoto('#c49a6c')],
        health_flags: ['senior', 'mobility_aid'],
      }),
      pet({
        id: 'pet-misha',
        owner_id: null,
        name: 'Misha',
        species: 'cat',
        size: 'small',
        colors: ['orange', 'white'],
        photo_urls: [mockPhoto('#d08a4a')],
      }),
      pet({
        id: 'pet-simon',
        owner_id: 'user-andres',
        name: 'Simón',
        species: 'dog',
        size: 'large',
        colors: ['black'],
        photo_urls: [mockPhoto('#2b2b2b')],
      }),
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
    adoptionInterests: [
      interest('int-nube-andres', 'AD9PT', 'user-andres', '+573000000001', DAY, {
        intro: {
          housing: 'apartment',
          has_yard: false,
          other_pets: 'Una gata de 4 años, esterilizada',
          household: 'Vivo con mi pareja',
          why: 'Nuestra gata es muy sociable y queremos que tenga compañía.',
        },
      }),
      interest('int-canela-camilo', 'B3TOS', 'user-camilo', '+573000000004', 2 * DAY, {
        status: 'chosen',
        first_responded_at: ago(DAY),
        intro: {
          housing: 'house',
          has_yard: true,
          other_pets: null,
          household: 'Mis papás y yo',
          why: 'Tuvimos un perro mayor y sabemos cuidarlo.',
        },
      }),
      interest('int-canela-andres', 'B3TOS', 'user-andres', '+573000000001', DAY),
      interest('int-misha-andres', 'M1SHI', 'user-andres', '+573000000001', 5 * HOUR, {
        intro: {
          housing: 'apartment',
          has_yard: false,
          other_pets: 'Una gata de 4 años, esterilizada',
          household: 'Vivo con mi pareja',
          why: 'Buscamos una compañera para nuestra gata.',
        },
      }),
      interest('int-misha-julian', 'M1SHI', 'user-julian', '+573000000003', 2 * DAY, {
        intro: {
          housing: 'house',
          has_yard: true,
          other_pets: null,
          household: 'Somos cuatro, con dos niños de 8 y 10 años',
          why: 'Los niños llevan un año pidiendo un gato.',
        },
      }),
      interest('int-simon-andres', 'ADPT8', 'user-andres', '+573000000001', 20 * DAY, {
        status: 'chosen',
        first_responded_at: ago(15 * DAY),
        intro: {
          housing: 'house',
          has_yard: true,
          other_pets: null,
          household: null,
          why: 'Tengo patio grande y salgo a correr todos los días.',
        },
      }),
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
      // Misha's first «¿sigue disponible?» (T+7 d) fell due yesterday.
      checkin('ck-misha-1', 'M1SHI', null, 'time_based', ago(DAY)),
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
