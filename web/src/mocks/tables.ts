// The emulated backend's tables: rows hold what the server knows — owners, reporters' numbers,
// hidden pins — and serialize.ts decides what each viewer gets to see, as the real backend must.
import type {
  AdoptionResolution,
  HealthFlag,
  Housing,
  RequirementFlag,
  Temperament,
} from '../contracts/adoption'
import type { Color, Point } from '../contracts/primitives'

export type Species = 'dog' | 'cat' | 'other'
export type Size = 'small' | 'medium' | 'large'
export type ContactPrefs = { expose_whatsapp: boolean; expose_email: boolean; in_app_only: boolean }
export type Area = { center: Point; radius_m: number; at: string; place_name: string }

export type PersonRow = {
  id: string
  display_name: string
  email: string
  /** Verified by SMS at a first publish. */
  phone: string | null
  city: string | null
  bio: string | null
  notification_prefs: { lost: boolean; found: boolean; adoption: boolean; help: boolean }
  /** «miembro hace 8 meses»: a fact the adoption lister reads next to a name (06). */
  joined_at: string
}

export type PetRow = {
  id: string
  /** The person with the owner link; null while nobody has claimed a found animal. */
  owner_id: string | null
  name: string | null
  species: Species
  size: Size | null
  colors: Color[]
  marks: string | null
  chip_number: string | null
  photo_urls: string[]
  /** `claimed` once someone holds the owner link — even when it is off the platform (06). */
  custody_state: 'claimed' | 'unclaimed' | 'org_held'
  /** Durable: a condition survives every case and every adoption (06 · `pet`). */
  health_flags: HealthFlag[]
}

type Published = {
  code: string
  pet_id: string
  created_by: string
  published_at: string
  resolved_at: string | null
  resolution: string | null
  resolution_attribution: string | null
  contact_prefs: ContactPrefs
  /** The number this case exposes: the publisher's verified one at publish time. */
  contact_phone: string
  phone_has_whatsapp: boolean
}

export type LostRow = Published & {
  vertical: 'lost'
  status: 'active' | 'reunited' | 'expired' | 'cancelled'
  last_seen: Area
}

export type FoundRow = Published & {
  vertical: 'found'
  status:
    | 'active'
    | 'reunited'
    | 'kept'
    | 'converted'
    | 'transferred_to_org'
    | 'expired'
    | 'cancelled'
  found: Area
  holding_where: 'home' | 'vet' | 'street_temporary' | 'no_longer_held'
  held_since: string
  hold_offer_at: string
  withheld_detail: string | null
  org_name: string | null
  /** Set on `converted`: the adoption listing this animal moved to. */
  successor_case_code: string | null
}

export type AdoptionRow = Published & {
  vertical: 'adoption'
  status: 'active' | 'adopted' | 'withdrawn' | 'expired'
  resolution: AdoptionResolution | null
  /** Set when the listing was born from a found case's day-15 conversion (05). */
  predecessor_case_code: string | null
  story: string
  temperament: Temperament[]
  requirement_flags: RequirementFlag[]
  requirements: string | null
  /** B2P seam: only `light` is legal in v1 and nothing branches on it. */
  lane: 'light' | 'application'
  location: Area
  external_url: string | null
  /** Only orgs with reviewed documents are `verified`; there are no orgs in the emulation. */
  trust_tier: 'verified' | 'individual'
}

export type AdoptionInterestRow = {
  id: string
  case_code: string
  /** Always registered: adopting is a commitment, not a tip. */
  person_id: string
  /** B2P seams: only `interest` is legal in v1, and `form_data` stays unwritten. */
  kind: 'interest' | 'application'
  form_data: null
  intro: {
    housing: Housing
    has_yard: boolean
    other_pets: string | null
    household: string | null
    why: string
  }
  /** The number the person verified, and whether it has WhatsApp: the lister's way back. */
  contact_phone: string
  phone_has_whatsapp: boolean
  status: 'open' | 'chosen' | 'declined' | 'withdrawn'
  created_at: string
  /** The lister's first move on it; powers the «sin responder» nudge once it exists. */
  first_responded_at: string | null
}

/** Help has no flow yet: a card's worth of data, so feed and links resolve. */
export type CardRow = {
  code: string
  vertical: 'help'
  status: 'active'
  title: string
  species: Species
  place_name: string
  point: Point
  photo_url: string | null
  published_at: string
  detail: string | null
}

export type CaseRow = LostRow | FoundRow | AdoptionRow | CardRow

export type SightingRow = {
  id: string
  /** Null for an orphan: a witness report nothing could attach to yet (docs/product/05). */
  case_code: string | null
  /** Orphans only: what the witness saw, for matching. */
  species: Species | null
  point: Point
  seen_at: string
  created_at: string
  note: string | null
  photo_urls: string[]
  reporter_id: string | null
  /** The rate-limit handle for anonymous reporters (device/IP in the real backend). */
  reporter_key: string
  contact_phone: string | null
  status: 'visible' | 'hidden_by_owner'
  highlighted_by_owner: boolean
}

export type RecoveryClaimRow = {
  id: string
  case_code: string
  phone: string
  claimant_id: string | null
  created_at: string
  status: 'open' | 'confirmed' | 'dismissed' | 'stale'
  /** No verdict by then and the «posible hallazgo» badge drops (docs/product/04 · Schedule). */
  stale_at: string
}

export type OwnershipClaimRow = {
  id: string
  case_code: string
  claimant_id: string
  created_at: string
  status: 'open' | 'confirmed' | 'dismissed' | 'withdrawn' | 'stale'
  evidence_notes: string | null
  chip_number: string | null
  photo_urls: string[]
  from_lost_case_code: string | null
}

export type CheckinRow = {
  id: string
  case_code: string
  claim_id: string | null
  trigger: 'time_based' | 'post_recovery_claim'
  scheduled_at: string
  responded_at: string | null
  cancelled_at: string | null
  response: string | null
}

export type NotificationRow = {
  id: string
  person_id: string
  event: string
  body: string
  case_code: string | null
  created_at: string
  read_at: string | null
}

export type PushRow = {
  id: string
  person_id: string
  kind: 'webpush' | 'fcm' | 'apns'
  token: string
  device: string | null
}

export type ReportRow = {
  id: string
  target_type: string
  target_id: string
  reason: string
  note: string | null
  reporter_id: string | null
  created_at: string
}

export type Tables = {
  persons: PersonRow[]
  pets: PetRow[]
  cases: Record<string, CaseRow>
  /** Codes that existed and were purged: they answer `gone`, so a printed poster never 404s. */
  purged: string[]
  sightings: SightingRow[]
  recoveryClaims: RecoveryClaimRow[]
  ownershipClaims: OwnershipClaimRow[]
  adoptionInterests: AdoptionInterestRow[]
  checkins: CheckinRow[]
  notifications: NotificationRow[]
  pushSubscriptions: PushRow[]
  reports: ReportRow[]
  nextId: number
}
