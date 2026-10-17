// Rows → wire, per viewer. Who asks decides what they get: claims, reporters' numbers, hidden pins
// and the withheld detail go to the person responsible for the case and to nobody else.
import type { api, WireOf } from '../contracts/api'
import type { Point } from '../contracts/primitives'
import { archivesAt } from './cadence'
import { DAY, iso, lookSummary, lookTitle, metres, ms, publicName, whatsappUrl } from './rules'
import type {
  AdoptionRow,
  CaseRow,
  FoundRow,
  HelpRow,
  LostRow,
  PersonRow,
  SightingRow,
  Tables,
} from './tables'

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
/** Adoption timelines are months: a December listing is likely to come back in February (06). */
export const ADOPTION_REOPEN_WINDOW = 90 * DAY

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
  const vertical = t.cases[code]?.vertical
  return due
    ? {
        id: due.id,
        trigger: due.trigger,
        claim_id: due.claim_id,
        asked_at: due.scheduled_at,
        archives_at:
          due.trigger === 'time_based' && vertical ? archivesAt(vertical, due.scheduled_at) : null,
      }
    : null
}

function lostView(
  t: Tables,
  row: LostRow,
  viewerId: string | null,
  device: string | null,
): CaseWire {
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
        ...ownership(s, viewerId, device),
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
    successor_case_code: row.successor_case_code,
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
    pending_checkin: custodian ? pendingCheckin(t, row.code) : null,
    contact: contact(t, row),
  }
}

/**
 * The channels a listing opens once an interest row exists (06 · Channel, after the row). Never
 * before: contacting the lister is only ever through an interest.
 */
export function listingChannels(row: AdoptionRow) {
  const whatsapp = row.contact_prefs.expose_whatsapp && row.phone_has_whatsapp
  return {
    whatsapp_url: whatsapp ? whatsappUrl(row.contact_phone) : null,
    external_url: row.external_url,
  }
}

/** «En proceso»: `EXISTS interest WHERE status = 'chosen'` — a badge and a ranking weight. */
export const isReserved = (t: Tables, code: string) =>
  t.adoptionInterests.some((i) => i.case_code === code && i.status === 'chosen')

/** Interests that still count: not withdrawn, on a listing that is still open. */
export function openAdoptionInterests(t: Tables, personId: string) {
  return t.adoptionInterests.filter(
    (i) =>
      i.person_id === personId &&
      i.status !== 'withdrawn' &&
      t.cases[i.case_code]?.status === 'active',
  ).length
}

function adoptionView(t: Tables, row: AdoptionRow, viewerId: string | null): CaseWire {
  const lister = viewerId !== null && row.created_by === viewerId
  const pet = petOf(t, row.pet_id)
  const publisher = person(t, row.created_by)
  const interests = t.adoptionInterests.filter((i) => i.case_code === row.code)
  const mine = viewerId ? interests.find((i) => i.person_id === viewerId) : undefined
  const channels =
    row.status === 'active' ? listingChannels(row) : { whatsapp_url: null, external_url: null }
  return {
    code: row.code,
    vertical: 'adoption',
    status: row.status,
    resolution: row.resolution,
    published_at: row.published_at,
    resolved_at: row.resolved_at,
    viewer: lister ? 'lister' : 'public',
    pet: {
      name: pet.name ?? '',
      species: pet.species,
      size: pet.size,
      colors: pet.colors,
      marks: pet.marks,
      photo_urls: pet.photo_urls,
      health_flags: pet.health_flags,
    },
    story: row.story,
    temperament: row.temperament,
    requirement_flags: row.requirement_flags,
    requirements: row.requirements,
    location: {
      center: row.location.center,
      radius_m: row.location.radius_m,
      place_name: row.location.place_name,
    },
    trust_tier: row.trust_tier,
    lister_name: publisher ? publicName(publisher.display_name) : '',
    reserved: isReserved(t, row.code),
    // A decline is silent: to the adopter it reads as still open (06 · What the lister sees).
    my_interest:
      mine && !lister
        ? {
            id: mine.id,
            status: mine.status === 'declined' ? 'open' : mine.status,
            created_at: mine.created_at,
            ...channels,
          }
        : null,
    interests: lister
      ? interests
          .filter((i) => i.status !== 'withdrawn')
          .sort((a, b) => ms(a.created_at) - ms(b.created_at))
          .map((i) => {
            const who = person(t, i.person_id)
            return {
              id: i.id,
              status: i.status as 'open' | 'chosen' | 'declined',
              created_at: i.created_at,
              person: {
                display_name: who ? publicName(who.display_name) : 'Alguien',
                city: who?.city ?? null,
                member_since: who?.joined_at ?? i.created_at,
                sightings_reported: t.sightings.filter((s) => s.reporter_id === i.person_id).length,
                open_adoption_interests: openAdoptionInterests(t, i.person_id),
              },
              intro: i.intro,
              whatsapp_url: i.phone_has_whatsapp ? whatsappUrl(i.contact_phone) : null,
            }
          })
      : [],
    pending_checkin: lister ? pendingCheckin(t, row.code) : null,
  }
}

/** What a need got: confirmed by the beneficiary, and promised but not yet confirmed (07). */
export function needProgress(t: Tables, code: string, needId: string) {
  const pledges = t.helpPledges.filter((p) => p.case_code === code && p.need_id === needId)
  const sum = (status: 'pledged' | 'confirmed') =>
    pledges.filter((p) => p.status === status).reduce((total, p) => total + p.quantity, 0)
  return { confirmed: sum('confirmed'), pledged: sum('pledged') }
}

/** The way back to the beneficiary, per their contact prefs; null = in-app only. */
export function beneficiaryChannel(row: HelpRow): string | null {
  return row.status === 'active' && row.contact_prefs.expose_whatsapp && row.phone_has_whatsapp
    ? whatsappUrl(row.contact_phone)
    : null
}

function helpView(t: Tables, row: HelpRow, viewerId: string | null): CaseWire {
  const beneficiary = viewerId !== null && row.created_by === viewerId
  const pet = petOf(t, row.pet_id)
  const publisher = person(t, row.created_by)
  const pledges = t.helpPledges.filter((p) => p.case_code === row.code)
  const channel = beneficiaryChannel(row)
  return {
    code: row.code,
    vertical: 'help',
    status: row.status,
    resolution: row.resolution,
    published_at: row.published_at,
    resolved_at: row.resolved_at,
    viewer: beneficiary ? 'beneficiary' : 'public',
    pet: {
      // A found animal has no name: the request names it by what it looks like (05).
      name: pet.name ?? lookTitle(pet),
      species: pet.species,
      size: pet.size,
      colors: pet.colors,
      marks: pet.marks,
      photo_urls: pet.photo_urls,
    },
    story: row.story,
    photo_urls: row.photo_urls ?? [],
    location: {
      center: row.location.center,
      radius_m: row.location.radius_m,
      place_name: row.location.place_name,
    },
    trust_tier: row.trust_tier,
    beneficiary_name: publisher ? publicName(publisher.display_name) : '',
    needs: row.needs.map((need) => ({
      id: need.id,
      kind: need.kind,
      detail: need.detail,
      target: need.target,
      needed_by: need.needed_by,
      status: need.status,
      ...needProgress(t, row.code, need.id),
    })),
    my_pledges:
      viewerId && !beneficiary
        ? pledges
            .filter((p) => p.person_id === viewerId)
            .map((p) => ({
              id: p.id,
              need_id: p.need_id,
              quantity: p.quantity,
              note: p.note,
              status: p.status,
              created_at: p.created_at,
              whatsapp_url: channel,
            }))
        : [],
    pledges: beneficiary
      ? pledges
          .filter((p) => p.status !== 'withdrawn')
          .sort((a, b) => ms(a.created_at) - ms(b.created_at))
          .map((p) => {
            const who = person(t, p.person_id)
            return {
              id: p.id,
              need_id: p.need_id,
              quantity: p.quantity,
              note: p.note,
              status: p.status as 'pledged' | 'confirmed' | 'declined',
              created_at: p.created_at,
              person_name: who ? publicName(who.display_name) : 'Alguien',
              phone: p.contact_phone,
              whatsapp_url: p.phone_has_whatsapp ? whatsappUrl(p.contact_phone) : null,
            }
          })
      : [],
    pending_checkin: beneficiary ? pendingCheckin(t, row.code) : null,
  }
}

const NEED_NAMES = {
  foster: 'hogar temporal',
  transport: 'transporte',
  supplies: 'insumos',
} as const

/** «Necesita hogar temporal y transporte» — the server composes it; the emulation speaks Spanish. */
function needsLine(row: HelpRow): string {
  const open = row.needs.filter((n) => n.status === 'open').map((n) => NEED_NAMES[n.kind])
  if (open.length === 0) return 'Ya tiene lo que pidió'
  const list = open.length > 1 ? `${open.slice(0, -1).join(', ')} y ${open.at(-1)}` : open[0]
  return `Necesita ${list}`
}

/** The pin is the viewer's own, and for how long they may still correct it (04 · Correction window). */
export const EDIT_WINDOW = 15 * 60_000
export function ownership(s: SightingRow, viewerId: string | null, device: string | null) {
  const mine =
    (viewerId !== null && s.reporter_id === viewerId) ||
    (device !== null && s.reporter_key === device)
  const until = ms(s.created_at) + EDIT_WINDOW
  return {
    mine,
    editable_until: mine && s.status === 'visible' && until > Date.now() ? iso(until) : null,
  }
}

export function caseView(
  t: Tables,
  row: CaseRow,
  viewerId: string | null,
  device: string | null = null,
): CaseWire {
  if (row.vertical === 'lost') return lostView(t, row, viewerId, device)
  if (row.vertical === 'found') return foundView(t, row, viewerId)
  if (row.vertical === 'adoption') return adoptionView(t, row, viewerId)
  return helpView(t, row, viewerId)
}

function feedItem(t: Tables, row: CaseRow): FeedItem | null {
  if (row.status !== 'active') return null
  const pet = petOf(t, row.pet_id)
  if (row.vertical === 'help') {
    return {
      code: row.code,
      vertical: 'help',
      title: pet.name ?? lookTitle(pet),
      species: pet.species,
      summary: lookSummary(pet),
      place_name: row.location.place_name,
      point: row.location.center,
      photo_url: pet.photo_urls[0] ?? null,
      happened_at: row.published_at,
      possible_find: false,
      sightings_count: null,
      last_sighting_at: null,
      detail: needsLine(row),
    }
  }
  if (row.vertical === 'adoption') {
    const reserved = isReserved(t, row.code)
    return {
      code: row.code,
      vertical: 'adoption',
      title: pet.name ?? lookTitle(pet),
      species: pet.species,
      summary: lookSummary(pet),
      place_name: row.location.place_name,
      point: row.location.center,
      photo_url: pet.photo_urls[0] ?? null,
      happened_at: row.published_at,
      possible_find: false,
      sightings_count: null,
      last_sighting_at: null,
      detail: reserved ? 'En proceso' : null,
    }
  }
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

/**
 * Newest published first; near the viewer, or the whole country when nothing is near. An adoption
 * listing «en proceso» goes after the rest: attention on a pet already spoken for is stolen from
 * the others — the deliberate inverse of lost's never-reduce-reach rule (06).
 */
export function feedView(t: Tables, near: Point | null): FeedWire {
  const rows = Object.values(t.cases).sort((a, b) => ms(b.published_at) - ms(a.published_at))
  const demoted = (row: CaseRow) => row.vertical === 'adoption' && isReserved(t, row.code)
  const items = [...rows.filter((row) => !demoted(row)), ...rows.filter(demoted)].flatMap(
    (row) => feedItem(t, row) ?? [],
  )
  const center = near ?? DEFAULT_CENTER
  const local = items.filter((item) => metres(pointOf(item), center) <= NEAR_M)
  return local.length > 0 ? { scope: 'local', items: local } : { scope: 'national', items }
}

export function myCasesView(t: Tables, personId: string): WireOf<typeof api.listMyCases> {
  return (
    Object.values(t.cases)
      .filter((row) => row.created_by === personId)
      .sort((a, b) => ms(b.published_at) - ms(a.published_at))
      .map((row) => {
        const pet = petOf(t, row.pet_id)
        if (row.vertical === 'help') {
          return {
            code: row.code,
            vertical: row.vertical,
            status: row.status,
            title: pet.name ?? lookTitle(pet),
            place_name: row.location.place_name,
            photo_url: pet.photo_urls[0] ?? null,
            published_at: row.published_at,
            // On a request, the offers waiting for the beneficiary to say whether they arrived.
            open_claim_count: t.helpPledges.filter(
              (p) => p.case_code === row.code && p.status === 'pledged',
            ).length,
          }
        }
        if (row.vertical === 'adoption') {
          return {
            code: row.code,
            vertical: row.vertical,
            status: row.status,
            title: pet.name ?? lookTitle(pet),
            place_name: row.location.place_name,
            photo_url: pet.photo_urls[0] ?? null,
            published_at: row.published_at,
            // On a listing, the people waiting for an answer.
            open_claim_count: t.adoptionInterests.filter(
              (i) => i.case_code === row.code && i.status === 'open',
            ).length,
          }
        }
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
      // The question owed on each case, for home's banner (comms.md · Actionable check-ins).
      .map((item) => ({
        ...item,
        pending_checkin_at: pendingCheckin(t, item.code)?.asked_at ?? null,
      }))
  )
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
  photo_url: p.photo_url ?? null,
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
