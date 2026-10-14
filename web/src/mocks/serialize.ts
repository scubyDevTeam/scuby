// Rows → wire, per viewer. Who asks decides what they get: claims, reporters' numbers, hidden pins
// and the withheld detail go to the person responsible for the case and to nobody else.
import type { api, WireOf } from '../contracts/api'
import type { Point } from '../contracts/primitives'
import { DAY, lookSummary, lookTitle, metres, ms, publicName, whatsappUrl } from './rules'
import type { CardRow, CaseRow, FoundRow, LostRow, PersonRow, Tables } from './tables'

type CaseWire = WireOf<typeof api.getCase>
type FeedWire = WireOf<typeof api.getFeed>
type FeedItem = FeedWire['items'][number]

const person = (t: Tables, id: string | null) => t.persons.find((p) => p.id === id) ?? null
const petOf = (t: Tables, id: string) => {
  const found = t.pets.find((p) => p.id === id)
  if (!found) throw new Error(`Broken state: no pet ${id}`)
  return found
}

/** Where a map opens and «near» is measured from when the viewer gives no position. */
export const DEFAULT_CENTER: Point = { lat: 6.2442, lng: -75.5812 }
/** What counts as near for the feed. */
const NEAR_M = 25_000
/** An expired case can be reopened for this long (docs/product/04 · Schedule). */
export const REOPEN_WINDOW = 30 * DAY

function contact(t: Tables, row: LostRow | FoundRow) {
  // Only an open case invites contact; a closed one has nothing left to ask.
  if (row.status !== 'active') return null
  const publisher = person(t, row.created_by)
  if (!publisher) return null
  const whatsapp = row.contact_prefs.expose_whatsapp && row.phone_has_whatsapp
  return {
    display_name: publicName(publisher.display_name),
    whatsapp_url: whatsapp ? whatsappUrl(row.contact_phone) : null,
  }
}

/** The oldest check-in that is due and unanswered. */
export function pendingCheckin(t: Tables, code: string, at = Date.now()) {
  const due = t.checkins
    .filter(
      (c) => c.case_code === code && !c.responded_at && !c.cancelled_at && ms(c.scheduled_at) <= at,
    )
    .sort((a, b) => ms(a.scheduled_at) - ms(b.scheduled_at))[0]
  return due
    ? { id: due.id, trigger: due.trigger, claim_id: due.claim_id, asked_at: due.scheduled_at }
    : null
}

function lostView(t: Tables, row: LostRow, viewerId: string | null): CaseWire {
  const owner = viewerId !== null && row.created_by === viewerId
  const pet = petOf(t, row.pet_id)
  const claims = t.recoveryClaims.filter((c) => c.case_code === row.code)
  return {
    code: row.code,
    vertical: 'lost',
    status: row.status,
    resolved_at: row.resolved_at,
    viewer: owner ? 'owner' : 'public',
    pet: {
      name: pet.name ?? '',
      species: pet.species,
      size: pet.size,
      colors: pet.colors,
      marks: pet.marks,
      photo_urls: pet.photo_urls,
    },
    last_seen: row.last_seen,
    open_claim_count: claims.filter((c) => c.status === 'open').length,
    sightings: t.sightings
      .filter((s) => s.case_code === row.code && (owner || s.status === 'visible'))
      .sort((a, b) => ms(a.seen_at) - ms(b.seen_at))
      .map((s) => ({
        id: s.id,
        point: s.point,
        seen_at: s.seen_at,
        note: s.note,
        photo_urls: s.photo_urls,
        source: s.reporter_id ? 'registered' : 'anonymous',
        highlighted_by_owner: s.highlighted_by_owner,
        contact_phone: owner ? s.contact_phone : null,
        hidden: s.status !== 'visible',
      })),
    claims: owner
      ? claims.map((c) => ({
          id: c.id,
          phone: c.phone,
          created_at: c.created_at,
          status: c.status,
        }))
      : [],
    pending_checkin: owner ? pendingCheckin(t, row.code) : null,
    contact: contact(t, row),
  }
}

function foundView(t: Tables, row: FoundRow, viewerId: string | null): CaseWire {
  const custodian = viewerId !== null && row.created_by === viewerId
  const pet = petOf(t, row.pet_id)
  const claims = t.ownershipClaims.filter((c) => c.case_code === row.code)
  return {
    code: row.code,
    vertical: 'found',
    status: row.status,
    resolved_at: row.resolved_at,
    viewer: custodian ? 'custodian' : 'public',
    pet: {
      species: pet.species,
      size: pet.size,
      colors: pet.colors,
      marks: pet.marks,
      photo_urls: pet.photo_urls,
    },
    found: row.found,
    holding_where: row.holding_where,
    held_since: row.held_since,
    hold_offer_at: row.hold_offer_at,
    open_claim_count: claims.filter((c) => c.status === 'open').length,
    withheld_detail: custodian ? row.withheld_detail : null,
    ownership_claims: custodian
      ? claims.map((c) => {
          const claimant = person(t, c.claimant_id)
          return {
            id: c.id,
            claimant_name: claimant ? publicName(claimant.display_name) : 'Alguien',
            created_at: c.created_at,
            status: c.status,
            evidence_notes: c.evidence_notes,
            chip_number: c.chip_number,
            photo_count: c.photo_urls.length,
            from_lost_case_code: c.from_lost_case_code,
            whatsapp_url: claimant?.phone ? whatsappUrl(claimant.phone) : null,
          }
        })
      : [],
    contact: contact(t, row),
  }
}

export function caseView(t: Tables, row: CaseRow, viewerId: string | null): CaseWire {
  if (row.vertical === 'lost') return lostView(t, row, viewerId)
  if (row.vertical === 'found') return foundView(t, row, viewerId)
  return {
    code: row.code,
    vertical: row.vertical,
    status: row.status,
    title: row.title,
    place_name: row.place_name,
    photo_url: row.photo_url,
  }
}

const isCard = (row: CaseRow): row is CardRow =>
  row.vertical === 'adoption' || row.vertical === 'help'

function feedItem(t: Tables, row: CaseRow): FeedItem | null {
  if (row.status !== 'active') return null
  if (isCard(row)) {
    return {
      code: row.code,
      vertical: row.vertical,
      title: row.title,
      species: row.species,
      summary: null,
      place_name: row.place_name,
      point: row.point,
      photo_url: row.photo_url,
      happened_at: row.published_at,
      possible_find: false,
      sightings_count: null,
      last_sighting_at: null,
      detail: row.detail,
    }
  }
  const pet = petOf(t, row.pet_id)
  if (row.vertical === 'found') {
    return {
      code: row.code,
      vertical: 'found',
      title: lookTitle(pet),
      species: pet.species,
      summary: null,
      place_name: row.found.place_name,
      point: row.found.center,
      photo_url: pet.photo_urls[0] ?? null,
      happened_at: row.found.at,
      possible_find: false,
      sightings_count: null,
      last_sighting_at: null,
      detail: null,
    }
  }
  const sightings = t.sightings.filter((s) => s.case_code === row.code && s.status === 'visible')
  const latest = sightings.map((s) => s.seen_at).sort((a, b) => ms(b) - ms(a))[0] ?? null
  return {
    code: row.code,
    vertical: 'lost',
    title: pet.name ?? lookTitle(pet),
    species: pet.species,
    summary: lookSummary(pet),
    place_name: row.last_seen.place_name,
    point: row.last_seen.center,
    photo_url: pet.photo_urls[0] ?? null,
    happened_at: row.last_seen.at,
    possible_find: t.recoveryClaims.some((c) => c.case_code === row.code && c.status === 'open'),
    sightings_count: sightings.length,
    last_sighting_at: latest,
    detail: null,
  }
}

const pointOf = (item: FeedItem) => item.point

/** Newest published first; near the viewer, or the whole country when nothing is near. */
export function feedView(t: Tables, near: Point | null): FeedWire {
  const items = Object.values(t.cases)
    .sort((a, b) => ms(b.published_at) - ms(a.published_at))
    .flatMap((row) => feedItem(t, row) ?? [])
  const center = near ?? DEFAULT_CENTER
  const local = items.filter((item) => metres(pointOf(item), center) <= NEAR_M)
  return local.length > 0 ? { scope: 'local', items: local } : { scope: 'national', items }
}

export function myCasesView(t: Tables, personId: string): WireOf<typeof api.listMyCases> {
  return Object.values(t.cases)
    .filter((row): row is LostRow | FoundRow => 'created_by' in row && row.created_by === personId)
    .sort((a, b) => ms(b.published_at) - ms(a.published_at))
    .map((row) => {
      const pet = petOf(t, row.pet_id)
      const lost = row.vertical === 'lost'
      const claims = lost
        ? t.recoveryClaims.filter((c) => c.case_code === row.code)
        : t.ownershipClaims.filter((c) => c.case_code === row.code)
      return {
        code: row.code,
        vertical: row.vertical,
        status: row.status,
        title: lost ? (pet.name ?? lookTitle(pet)) : lookTitle(pet),
        place_name: lost ? row.last_seen.place_name : row.found.place_name,
        photo_url: pet.photo_urls[0] ?? null,
        published_at: row.published_at,
        open_claim_count: claims.filter((c) => c.status === 'open').length,
      }
    })
}

export function petsView(t: Tables, personId: string): WireOf<typeof api.listMyPets> {
  const lostCases = Object.values(t.cases).filter((row): row is LostRow => row.vertical === 'lost')
  return t.pets
    .filter((pet) => pet.owner_id === personId && pet.name)
    .map((pet) => {
      const own = lostCases.filter((row) => row.pet_id === pet.id)
      const reopenable = own.find(
        (row) =>
          row.status === 'expired' &&
          row.resolved_at !== null &&
          Date.now() - ms(row.resolved_at) <= REOPEN_WINDOW,
      )
      return {
        id: pet.id,
        name: pet.name ?? '',
        species: pet.species,
        size: pet.size,
        colors: pet.colors,
        marks: pet.marks,
        photo_urls: pet.photo_urls,
        active_case_code: own.find((row) => row.status === 'active')?.code ?? null,
        reopenable_case_code: reopenable?.code ?? null,
      }
    })
}

export const userView = (p: PersonRow): WireOf<typeof api.getSession> => ({
  id: p.id,
  display_name: p.display_name,
  email: p.email,
  phone: p.phone,
})

export const profileView = (p: PersonRow): WireOf<typeof api.getProfile> => ({
  display_name: p.display_name,
  email: p.email,
  phone: p.phone,
  city: p.city,
  bio: p.bio,
  notification_prefs: p.notification_prefs,
})

export function notificationsView(
  t: Tables,
  personId: string,
): WireOf<typeof api.listNotifications> {
  const mine = t.notifications
    .filter((n) => n.person_id === personId)
    .sort((a, b) => ms(b.created_at) - ms(a.created_at))
  return {
    unread_count: mine.filter((n) => !n.read_at).length,
    items: mine.map(({ person_id: _, ...n }) => n),
  }
}
