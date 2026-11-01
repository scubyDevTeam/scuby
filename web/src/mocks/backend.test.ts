// The emulated backend, driven through the real client: every request and answer below crosses the
// contract twice (route.ts checks both sides, http.ts parses), so a scenario that passes here is
// one the real backend must also pass. Rules: docs/product/04, 05, 08; conventions: docs/eng/api.md.
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, call } from '../api-client/http'
import { brand } from '../brand'
import { parseInterest } from '../contracts/adoption'
import { parseNearbyAlerts } from '../contracts/alerts'
import { api } from '../contracts/api'
import { parseCase } from '../contracts/case'
import { parseConversation, parseConversations, parseStarted } from '../contracts/conversations'
import { parseFeed } from '../contracts/feed'
import { parsePledge } from '../contracts/help'
import { parseCheckinLink } from '../contracts/links'
import {
  parseMyCases,
  parseNotifications,
  parsePets,
  parsePublish,
  parseUpload,
  uploadBody,
} from '../contracts/owner'
import { parseProfile, parseUser } from '../contracts/session'
import { env } from '../env'
import { DEMO_LINKS, linkToken } from './api/links'
import { db, type LostRow, resetDb } from './db'
import { DEMO_OWNER_ID as DEMO_OWNER_ID_FOR_TESTS } from './fixtures'
import { DEMO_CODE, handlers } from './handlers'
import { routed } from './route'
import { DAY, HOUR } from './rules'
import { signIn, signOut } from './session'

const server = setupServer(...handlers)
const asIs = (raw: unknown) => raw

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterAll(() => server.close())
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-14T12:00:00-05:00'))
  resetDb()
  signOut()
  vi.spyOn(console, 'error')
})
afterEach(() => {
  // route.ts logs every answer that breaks the contract: none may.
  expect(console.error).not.toHaveBeenCalled()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

async function failure(promise: Promise<unknown>) {
  try {
    await promise
  } catch (error) {
    if (error instanceof ApiError) return error
    throw error
  }
  throw new Error('expected the API to refuse')
}

/** Makes someone else's seeded lost case the demo account's, to try the owner's side on it. */
function handTo(code: string, personId: string, fields: Partial<LostRow> = {}) {
  const row = db.cases[code]
  if (row?.vertical !== 'lost') throw new Error(`${code} is not a lost case`)
  Object.assign(row, { created_by: personId, ...fields })
}

const later = (ms: number) => vi.setSystemTime(Date.now() + ms)
const caseOf = (code: string) => call(api.getCase, { params: { code } }, parseCase)
const asCarolina = () => call(api.googleSignIn, { body: { credential: 'demo' } }, parseUser)
const asNewcomer = (email: string) =>
  call(api.verifyEmailCode, { body: { email, code: DEMO_CODE } }, parseUser)

const kira = {
  pet_id: null,
  pet: {
    name: 'Kira',
    species: 'dog' as const,
    size: 'medium' as const,
    colors: ['brown' as const],
    marks: null,
    chip_number: null,
    photo_urls: [],
  },
  last_seen_point: { lat: 6.2447, lng: -75.5916 },
  last_seen_radius_m: 300,
  last_seen_at: new Date('2026-10-14T08:00:00-05:00').toISOString(),
  phone: '+573007152284',
  phone_has_whatsapp: true,
  contact_prefs: { expose_whatsapp: true, expose_email: false, in_app_only: false },
  otp_code: null,
}

async function publishKira() {
  await asNewcomer('ana.gomez@correo.co')
  await call(api.publishLost, { body: kira }, parsePublish)
  const published = await call(
    api.publishLost,
    { body: { ...kira, otp_code: DEMO_CODE } },
    parsePublish,
  )
  if (published.kind !== 'published') throw new Error('expected a published case')
  return published.code
}

describe('the emulated backend covers the contract', () => {
  it('answers every endpoint in api.ts', () => {
    for (const [name, endpoint] of Object.entries(api)) {
      expect(routed.has(endpoint), `${name} has no handler`).toBe(true)
    }
  })

  it('refuses a body the contract rejects, naming the field', async () => {
    const error = await failure(
      call(
        api.reportSighting,
        {
          params: { code: '7K3PQ' },
          body: { point: { lat: 200, lng: 0 }, seen_at: 'ayer', note: null, contact_phone: null },
        },
        asIs,
      ),
    )
    expect(error.code).toBe('validation_failed')
    expect(error.status).toBe(422)
  })

  it('answers `unauthorized` on a session endpoint with nobody signed in', async () => {
    expect((await failure(call(api.listMyCases, {}, asIs))).code).toBe('unauthorized')
  })
})

describe('what each viewer gets (04 · Location precision, 05 · withheld detail)', () => {
  it('a stranger gets no claims, no reporters’ numbers, no hidden pins, no check-in', async () => {
    db.sightings[0]!.status = 'hidden_by_owner'
    const luna = await caseOf('7K3PQ')
    if (luna.vertical !== 'lost') throw new Error('expected lost')
    expect(luna.viewer).toBe('public')
    expect(luna.claims).toEqual([])
    // Owner-only: a claim must never reduce reach (docs/product/04 · Rule: a recovery claim must never reduce reach).
    expect(luna.openClaimCount).toBeNull()
    expect(luna.sightings).toHaveLength(2)
    expect(luna.sightings.every((s) => s.contactPhone === null)).toBe(true)
  })

  it('the owner gets all of it', async () => {
    db.sightings[0]!.status = 'hidden_by_owner'
    await asCarolina()
    const luna = await caseOf('7k3pq')
    if (luna.vertical !== 'lost') throw new Error('expected lost')
    expect(luna.viewer).toBe('owner')
    expect(luna.claims.map((c) => c.phone)).toEqual(['+573114829017'])
    expect(luna.openClaimCount).toBe(1)
    expect(luna.sightings.filter((s) => s.hidden)).toHaveLength(1)
    expect(luna.sightings.some((s) => s.contactPhone)).toBe(true)
  })

  it('only the custodian gets the withheld detail and the claims on a found animal', async () => {
    const stranger = await caseOf('C4STD')
    await asCarolina()
    const custodian = await caseOf('C4STD')
    if (stranger.vertical !== 'found' || custodian.vertical !== 'found') throw new Error('found')
    expect(stranger.withheldDetail).toBeNull()
    expect(stranger.ownershipClaims).toEqual([])
    expect(custodian.withheldDetail).toBe('Collar verde con una campana')
    expect(custodian.ownershipClaims[0]?.claimantName).toBe('Andrés R.')
  })

  it('a purged code is `gone`, an unknown one `not_found`', async () => {
    expect((await failure(caseOf('GONE5'))).code).toBe('gone')
    expect((await failure(caseOf('ZZZZZ'))).code).toBe('not_found')
  })
})

describe('the feed (00 · Geography)', () => {
  it('is local around Medellín, newest published first, open cases only', async () => {
    const feed = await call(api.getFeed, { query: {} }, parseFeed)
    expect(feed.scope).toBe('local')
    expect(feed.items.map((i) => i.code)).toEqual([
      'F8UND',
      'M2TQ4',
      '7K3PQ',
      'NA7LA',
      'AD9PT',
      'HE7PA',
      'M1SHI',
      'C4STD',
      // «En proceso»: someone was chosen, so it ranks after everything still waiting (06).
      'B3TOS',
    ])
  })

  it('falls back to the whole country when nothing is near', async () => {
    const feed = await call(api.getFeed, { query: { lat: 4.711, lng: -74.0721 } }, parseFeed)
    expect(feed.scope).toBe('national')
    expect(feed.items.length).toBeGreaterThan(0)
  })
})

describe('«Lo vi» (04 · Validation)', () => {
  const sighting = (fields: Record<string, unknown> = {}) =>
    call(
      api.reportSighting,
      {
        params: { code: '7K3PQ' },
        body: {
          point: { lat: 6.2455, lng: -75.5905 },
          seen_at: new Date().toISOString(),
          note: null,
          contact_phone: null,
          ...fields,
        },
      },
      asIs,
    )

  it('is visible at once and tells the owner', async () => {
    await sighting({ note: 'En la 70' })
    await asCarolina()
    const luna = await caseOf('7K3PQ')
    if (luna.vertical !== 'lost') throw new Error('expected lost')
    expect(luna.sightings.at(-1)?.note).toBe('En la 70')
    const inbox = await call(api.listNotifications, {}, parseNotifications)
    expect(inbox.items[0]?.event).toBe('sighting.reported')
    expect(inbox.items[0]?.body).toMatch(
      /^Alguien vio a Luna hace 1 min a \d+ m de donde se perdió\.$/,
    )
  })

  // Fields are built inside the test: the clock is frozen only once it runs.
  it.each([
    ['sighting_too_far', () => ({ point: { lat: 4.711, lng: -74.0721 } })],
    ['seen_at_in_future', () => ({ seen_at: new Date(Date.now() + HOUR).toISOString() })],
    ['seen_at_before_case', () => ({ seen_at: new Date(Date.now() - 4 * DAY).toISOString() })],
  ])('refuses with `%s`', async (code, fields) => {
    expect((await failure(sighting(fields()))).code).toBe(code)
  })

  it('is rate-limited: five per reporter per case a day', async () => {
    for (let i = 0; i < 5; i++) await sighting()
    expect((await failure(sighting())).code).toBe('rate_limited')
    later(25 * HOUR)
    await sighting()
  })

  it('«Lo vi otra vez» inside the earlier pin’s correction window is not «hace poco» (04)', async () => {
    await sighting()
    later(60_000)
    await sighting()
  })

  // The offline queue resends until it hears back (frontend.md · Risks §6): an answer lost on a
  // weak signal must not become a second pin, nor a 429 that tells the reporter it failed.
  it('a replay with the same `client_id` is the same sighting: one row, the same id, no limit', async () => {
    const before = db.sightings.length
    const first = (await sighting({ client_id: 'c0ffee-replay-1' })) as { id: string }
    later(60_000)
    const again = (await sighting({ client_id: 'c0ffee-replay-1' })) as { id: string }
    expect(again.id).toBe(first.id)
    expect(db.sightings).toHaveLength(before + 1)
    // A different key is a different sighting.
    const other = (await sighting({ client_id: 'c0ffee-replay-2' })) as { id: string }
    expect(other.id).not.toBe(first.id)
  })

  it('cannot be added to a closed case', async () => {
    const code = 'H4PPY'
    const error = await failure(
      call(
        api.reportSighting,
        {
          params: { code },
          body: {
            point: { lat: 6.25, lng: -75.59 },
            seen_at: new Date().toISOString(),
            note: null,
            contact_phone: null,
          },
        },
        asIs,
      ),
    )
    expect(error.code).toBe('invalid_transition')
  })
})

describe('publishing a lost case (04 · Publishing, auth.md · phone step)', () => {
  it('asks for the SMS code first, then publishes into the feed and the owner’s lists', async () => {
    await asNewcomer('ana.gomez@correo.co')
    expect(await call(api.publishLost, { body: kira }, parsePublish)).toEqual({ kind: 'otp' })
    expect(
      (await failure(call(api.publishLost, { body: { ...kira, otp_code: '000000' } }, asIs))).code,
    ).toBe('invalid_code')

    const published = await call(
      api.publishLost,
      { body: { ...kira, otp_code: DEMO_CODE } },
      parsePublish,
    )
    if (published.kind !== 'published') throw new Error('expected published')
    const feed = await call(api.getFeed, { query: {} }, parseFeed)
    expect(feed.items[0]).toMatchObject({
      code: published.code,
      title: 'Kira',
      placeName: 'Laureles',
    })
    expect((await call(api.listMyCases, {}, parseMyCases))[0]?.code).toBe(published.code)

    // The number is verified now: the next publish goes straight through.
    const pets = await call(api.listMyPets, {}, parsePets)
    expect(pets[0]?.activeCaseCode).toBe(published.code)
  })

  it('blocks a second active case for the same pet, naming the open one', async () => {
    const code = await publishKira()
    const petId = (await call(api.listMyPets, {}, parsePets))[0]?.id ?? ''
    const error = await failure(
      call(api.publishLost, { body: { ...kira, pet_id: petId, phone: null } }, asIs),
    )
    expect(error.code).toBe('active_case_exists')
    expect(error.details).toEqual({ case_code: code })
  })

  it('needs a number when the account has none verified', async () => {
    await asNewcomer('sin.numero@correo.co')
    expect(
      (await failure(call(api.publishLost, { body: { ...kira, phone: null } }, asIs))).code,
    ).toBe('phone_required')
  })
})

describe('the owner’s side (04 · state machine)', () => {
  it('only the owner closes the case', async () => {
    await asNewcomer('vecino@correo.co')
    const error = await failure(
      call(
        api.reuniteCase,
        { params: { code: '7K3PQ' }, body: { resolution_attribution: 'unknown' } },
        asIs,
      ),
    )
    expect(error.code).toBe('forbidden')
  })

  it('a case closes once: reuniting it again answers the same success and keeps the first attribution', async () => {
    await asCarolina()
    const reunite = (resolution_attribution: 'platform_claim' | 'offline') =>
      call(api.reuniteCase, { params: { code: '7K3PQ' }, body: { resolution_attribution } }, asIs)
    await reunite('platform_claim')
    await reunite('offline')
    expect((await caseOf('7K3PQ')).status).toBe('reunited')
    expect(db.cases['7K3PQ']?.resolution_attribution).toBe('platform_claim')
  })

  it('starring a pin tells its registered reporter', async () => {
    await asCarolina()
    await call(
      api.moderateSighting,
      { params: { code: '7K3PQ', sightingId: 's3' }, body: { highlighted: true } },
      asIs,
    )
    expect(db.notifications.find((n) => n.person_id === 'user-andres')?.event).toBe(
      'sighting.highlighted',
    )
  })

  it('reopens an expired case within 30 days, and not after', async () => {
    handTo('ARCH2', 'user-carolina')
    await asCarolina()
    await call(api.reopenCase, { params: { code: 'ARCH2' } }, asIs)
    expect((await caseOf('ARCH2')).status).toBe('active')

    handTo('CANC3', 'user-carolina', {
      status: 'expired',
      resolved_at: new Date(Date.now() - 31 * DAY).toISOString(),
    })
    expect((await failure(call(api.reopenCase, { params: { code: 'CANC3' } }, asIs))).code).toBe(
      'invalid_transition',
    )
  })
})

describe('the follow-up loop (04 · Schedule)', () => {
  it('a claim asks the owner at +24 h; «sí, es ella» confirms it and closes the case', async () => {
    await asNewcomer('pedro.ruiz@correo.co') // «Lo tengo» needs a session (decision #75)
    const claim = (await call(
      api.claimRecovery,
      { params: { code: '7K3PQ' }, body: { phone: '+573001112233' } },
      asIs,
    )) as { id: string; whatsapp_url: string | null }
    expect(claim.whatsapp_url).toMatch(
      /^https:\/\/wa\.me\/573000000000\?text=Hola%2C%20vi%20tu%20aviso/,
    )

    await asCarolina()
    later(25 * HOUR)
    // The fixture's own claim fell due first; answer it to reach the new one.
    let luna = await caseOf('7K3PQ')
    if (luna.vertical !== 'lost' || !luna.pendingCheckin) throw new Error('expected a check-in')
    await call(
      api.answerCheckin,
      {
        params: { code: '7K3PQ', checkinId: luna.pendingCheckin.id },
        body: { response: 'still_verifying' },
      },
      asIs,
    )
    luna = await caseOf('7K3PQ')
    if (luna.vertical !== 'lost' || !luna.pendingCheckin) throw new Error('expected a check-in')
    expect(luna.pendingCheckin).toMatchObject({ trigger: 'post_recovery_claim', claimId: claim.id })

    await call(
      api.answerCheckin,
      {
        params: { code: '7K3PQ', checkinId: luna.pendingCheckin.id },
        body: { response: 'claim_confirmed' },
      },
      asIs,
    )
    luna = await caseOf('7K3PQ')
    if (luna.vertical !== 'lost') throw new Error('expected lost')
    expect(luna.status).toBe('reunited')
    expect(luna.claims.find((c) => c.id === claim.id)?.status).toBe('confirmed')
    expect(luna.pendingCheckin).toBeNull()
  })

  it('an answer must fit its check-in', async () => {
    await call(api.googleSignIn, { body: { credential: 'x' } }, asIs)
    handTo('M2TQ4', 'user-carolina')
    const milo = await caseOf('M2TQ4')
    if (milo.vertical !== 'lost' || !milo.pendingCheckin) throw new Error('expected a check-in')
    const error = await failure(
      call(
        api.answerCheckin,
        {
          params: { code: 'M2TQ4', checkinId: milo.pendingCheckin.id },
          body: { response: 'claim_dismissed' },
        },
        asIs,
      ),
    )
    expect(error.code).toBe('validation_failed')
  })

  it('two unanswered time-based check-ins expire the case; the claim goes stale on its own', async () => {
    const code = await publishKira()
    await asNewcomer('pedro.ruiz@correo.co') // the owner cannot claim their own case; a claim needs a session
    await call(api.claimRecovery, { params: { code }, body: { phone: '+573001112233' } }, asIs)
    await asNewcomer('ana.gomez@correo.co') // back to the owner: only she sees the claims and the inbox
    later(72 * HOUR + 7 * DAY + DAY + HOUR)
    const kiraCase = await caseOf(code)
    if (kiraCase.vertical !== 'lost') throw new Error('expected lost')
    expect(kiraCase.status).toBe('expired')
    expect(kiraCase.claims[0]?.status).toBe('stale')
    const inbox = await call(api.listNotifications, {}, parseNotifications)
    expect(inbox.items[0]?.event).toBe('lost_case.expired')
  })
})

describe('found (05)', () => {
  it('«es mío» reaches the custodian; confirming and reuniting hands the pet to its owner', async () => {
    await asNewcomer('laura.diaz@correo.co')
    const claim = (await call(
      api.claimOwnership,
      { params: { code: 'C4STD' }, body: { evidence_notes: 'Collar verde', chip_number: null } },
      asIs,
    )) as { id: string; whatsapp_url: string | null }
    expect(claim.whatsapp_url).toBe('https://wa.me/573000000000')

    await asCarolina()
    await call(
      api.answerOwnershipClaim,
      { params: { code: 'C4STD', claimId: claim.id }, body: { status: 'confirmed' } },
      asIs,
    )
    await call(
      api.resolveFound,
      {
        params: { code: 'C4STD' },
        body: {
          outcome: 'reunited',
          resolution_attribution: 'platform_claim',
          org_name: null,
          resolution: null,
        },
      },
      asIs,
    )
    expect((await caseOf('C4STD')).status).toBe('reunited')
    expect(db.pets.find((p) => p.id === 'pet-found-dog')?.owner_id).toBe(
      'user-laura.diaz@correo.co',
    )
    expect(db.notifications.some((n) => n.event === 'ownership_claim.confirmed')).toBe(true)
  })

  it('matching proposes lost pets of the same species nearby, with its reasons', async () => {
    const result = (await call(
      api.matchAnimal,
      {
        body: {
          species: 'dog',
          size: 'small',
          colors: ['black'],
          point: { lat: 6.2447, lng: -75.5916 },
          at: new Date().toISOString(),
        },
      },
      asIs,
    )) as { candidates: { code: string; why: string[] }[] }
    expect(result.candidates.map((c) => c.code)).toEqual(['7K3PQ'])
    expect(result.candidates[0]?.why).toContain('Mismo color: negro')
  })
})

const asAdoption = async (code: string) => {
  const parsed = await caseOf(code)
  if (parsed.vertical !== 'adoption') throw new Error(`${code} is not an adoption listing`)
  return parsed
}
const intro = {
  housing: 'apartment' as const,
  has_yard: false,
  other_pets: null,
  household: 'Vivo sola',
  why: 'Tengo tiempo y una casa tranquila.',
}
const interestIn = (code: string, extra: { phone?: string; otp_code?: string } = {}) =>
  call(
    api.expressInterest,
    {
      params: { code },
      body: {
        intro,
        phone: extra.phone ?? null,
        phone_has_whatsapp: true,
        otp_code: extra.otp_code ?? null,
      },
    },
    parseInterest,
  )

/** A newcomer with a verified number, interested in `code`. Answers the interest's id. */
async function newcomerInterestedIn(code: string, email = 'laura.diaz@correo.co') {
  await asNewcomer(email)
  expect((await interestIn(code, { phone: '+573001112233' })).kind).toBe('otp')
  const sent = await interestIn(code, { phone: '+573001112233', otp_code: DEMO_CODE })
  if (sent.kind !== 'sent') throw new Error('expected the interest to be sent')
  return sent
}

const listing = {
  from_found_case_code: null,
  lister_role: 'custodian' as const,
  pet: {
    name: 'Pelusa',
    species: 'cat' as const,
    size: 'small' as const,
    colors: ['white' as const],
    marks: null,
    photo_urls: ['data:image/png;base64,AAAA'],
    health_flags: ['fiv_felv' as const],
  },
  story: 'La rescaté de la calle.',
  temperament: [],
  requirement_flags: [],
  requirements: null,
  location_point: { lat: 6.2447, lng: -75.5916 },
  location_radius_m: 300,
  external_url: null,
  phone: null,
  phone_has_whatsapp: true,
  contact_prefs: { expose_whatsapp: true, expose_email: false, in_app_only: false },
  otp_code: null,
}

describe('adoption — who sees what (06 · What the lister sees, identity ladder)', () => {
  it('a stranger gets the listing, no interests, no channel: contact is only through an interest', async () => {
    const parsed = await asAdoption('AD9PT')
    expect(parsed.viewer).toBe('public')
    expect(parsed.interests).toEqual([])
    expect(parsed.myInterest).toBeNull()
    expect(parsed.pendingCheckin).toBeNull()
    expect(
      JSON.stringify(await call(api.getCase, { params: { code: 'AD9PT' } }, asIs)),
    ).not.toMatch(/wa\.me|573000000005/)
  })

  it('the lister gets each interest with its intro and facts from the account, never a verdict', async () => {
    await asCarolina()
    const misha = await asAdoption('M1SHI')
    expect(misha.viewer).toBe('lister')
    const andres = misha.interests.find((i) => i.person.displayName === 'Andrés R.')
    expect(andres?.intro.otherPets).toBe('Una gata de 4 años, esterilizada')
    expect(andres?.person.sightingsReported).toBe(1)
    // Nube, Canela and Misha: the collector signal is a number, nothing more.
    expect(andres?.person.openAdoptionInterests).toBe(3)
    expect(andres?.whatsappUrl).toBe('https://wa.me/573000000001')
    expect(misha.pendingCheckin?.trigger).toBe('time_based')
  })

  it('«en proceso» is public; who was chosen is not', async () => {
    const canela = await asAdoption('B3TOS')
    expect(canela.reserved).toBe(true)
    expect(canela.interests).toEqual([])
  })
})

describe('adoption — «Me interesa» (06 · adoption_interest, Channel after the row)', () => {
  it('needs an account', async () => {
    expect((await failure(interestIn('AD9PT'))).code).toBe('unauthorized')
  })

  it('needs a verified number: the SMS code first, then the row, then the channel', async () => {
    const sent = await newcomerInterestedIn('AD9PT')
    expect(sent.whatsappUrl).toBe('https://wa.me/573000000005')
    expect(sent.externalUrl).toBeNull()
    expect(db.notifications.some((n) => n.event === 'adoption_interest.created')).toBe(true)
    const mine = await asAdoption('AD9PT')
    expect(mine.myInterest).toMatchObject({ id: sent.id, status: 'open' })
    expect(mine.myInterest?.whatsappUrl).toBe('https://wa.me/573000000005')
  })

  it('one per person per listing: asking again answers the same row', async () => {
    const first = await newcomerInterestedIn('AD9PT')
    const again = await interestIn('AD9PT')
    expect(again.kind === 'sent' && again.id).toBe(first.id)
    expect(db.adoptionInterests.filter((i) => i.case_code === 'AD9PT')).toHaveLength(2)
  })

  it('names every channel the lister enabled; none means in-app', async () => {
    const row = db.cases.AD9PT
    if (row?.vertical !== 'adoption') throw new Error('adoption')
    row.external_url = 'https://fundacion.example/adopta'
    const both = await newcomerInterestedIn('AD9PT')
    expect(both.whatsappUrl && both.externalUrl).toBeTruthy()
    row.contact_prefs = { expose_whatsapp: false, expose_email: false, in_app_only: true }
    row.external_url = null
    const none = await newcomerInterestedIn('AD9PT', 'pedro.ruiz@correo.co')
    expect([none.whatsappUrl, none.externalUrl]).toEqual([null, null])
  })

  it('the lister cannot be interested in their own listing, nor anyone in a closed one', async () => {
    await asCarolina()
    expect((await failure(interestIn('M1SHI', { phone: '+573000000000' }))).code).toBe('forbidden')
    await asNewcomer('laura.diaz@correo.co')
    expect((await failure(interestIn('ADPT8', { phone: '+573001112233' }))).code).toBe(
      'invalid_transition',
    )
  })

  it('«ya no me interesa» takes it off the list; asking again brings it back open', async () => {
    const sent = await newcomerInterestedIn('AD9PT')
    await call(api.withdrawInterest, { params: { code: 'AD9PT', interestId: sent.id } }, asIs)
    expect((await asAdoption('AD9PT')).myInterest?.status).toBe('withdrawn')
    await interestIn('AD9PT')
    expect((await asAdoption('AD9PT')).myInterest?.status).toBe('open')
  })

  it('only its person withdraws an interest', async () => {
    await asNewcomer('laura.diaz@correo.co')
    const error = await failure(
      call(
        api.withdrawInterest,
        { params: { code: 'M1SHI', interestId: 'int-misha-andres' } },
        asIs,
      ),
    )
    expect(error.code).toBe('forbidden')
  })
})

describe('adoption — the lister’s moves (06 · What the lister sees)', () => {
  const answer = (interestId: string, status: 'chosen' | 'declined' | 'open', code = 'M1SHI') =>
    call(api.answerInterest, { params: { code, interestId }, body: { status } }, asIs)

  it('choosing someone tells them, reserves the listing and demotes it; one at a time', async () => {
    await asCarolina()
    await answer('int-misha-andres', 'chosen')
    expect(db.notifications.at(-1)).toMatchObject({
      person_id: 'user-andres',
      event: 'adoption_interest.chosen',
    })
    expect((await asAdoption('M1SHI')).reserved).toBe(true)
    expect((await failure(answer('int-misha-julian', 'chosen'))).code).toBe('invalid_transition')
    const feed = await call(api.getFeed, { query: {} }, parseFeed)
    expect(feed.items.slice(-2).map((i) => [i.code, i.detail])).toEqual([
      ['B3TOS', 'En proceso'],
      ['M1SHI', 'En proceso'],
    ])

    // «No se concretó»: manual, and full visibility comes back.
    await answer('int-misha-andres', 'open')
    expect((await asAdoption('M1SHI')).reserved).toBe(false)
    await answer('int-misha-julian', 'chosen')
  })

  it('a decline is silent: the adopter still reads their interest as open', async () => {
    await asCarolina()
    await answer('int-misha-andres', 'declined')
    expect(db.notifications.some((n) => n.person_id === 'user-andres')).toBe(false)
    db.persons.find((p) => p.id === 'user-andres')!.email = 'andres@correo.co'
    signOut()
    await asNewcomer('andres@correo.co')
    expect((await asAdoption('M1SHI')).myInterest?.status).toBe('open')
  })

  it('only the lister answers an interest', async () => {
    await asNewcomer('laura.diaz@correo.co')
    expect((await failure(answer('int-misha-andres', 'chosen'))).code).toBe('forbidden')
  })
})

describe('adoption — the endings (06 · Case state machine, `adopted` is a responsibility transfer)', () => {
  const adopt = (interestId: string | null, code = 'M1SHI') =>
    call(api.recordAdoption, { params: { code }, body: { interest_id: interestId } }, asIs)

  it('adopted in the app: the link moves to the adopter, and everyone else waiting is told', async () => {
    await asCarolina()
    await adopt('int-misha-andres')
    const misha = await asAdoption('M1SHI')
    expect([misha.status, misha.resolution]).toEqual(['adopted', 'adopted_in_app'])
    const pet = db.pets.find((p) => p.id === 'pet-misha')
    expect([pet?.owner_id, pet?.custody_state]).toEqual(['user-andres', 'claimed'])
    expect(
      db.notifications.filter((n) => n.event === 'adoption_case.adopted').map((n) => n.person_id),
    ).toEqual(['user-julian'])
    expect(
      db.checkins.filter((c) => c.case_code === 'M1SHI' && !c.cancelled_at && !c.responded_at),
    ).toEqual([])
    expect((await failure(adopt(null))).code).toBe('invalid_transition')
  })

  it('adopted off the platform: the link closes, and no owner is faked', async () => {
    await asCarolina()
    await adopt(null)
    expect((await asAdoption('M1SHI')).resolution).toBe('adopted_offline')
    const pet = db.pets.find((p) => p.id === 'pet-misha')
    expect([pet?.owner_id, pet?.custody_state]).toEqual([null, 'claimed'])
  })

  it('withdrawn, with its reason: who is responsible does not change', async () => {
    await asCarolina()
    await call(
      api.withdrawAdoption,
      { params: { code: 'M1SHI' }, body: { resolution: 'kept' } },
      asIs,
    )
    expect((await asAdoption('M1SHI')).status).toBe('withdrawn')
    expect(db.pets.find((p) => p.id === 'pet-misha')?.owner_id).toBeNull()
  })

  it('only the lister ends a listing', async () => {
    await asNewcomer('laura.diaz@correo.co')
    expect((await failure(adopt(null))).code).toBe('forbidden')
  })
})

describe('adoption — the follow-up loop (06 · Cadence, expiry, 90-day reopen)', () => {
  it('«sigue disponible» answers the check-in and resets the clock 14 days out', async () => {
    await asCarolina()
    const misha = await asAdoption('M1SHI')
    const checkinId = misha.pendingCheckin?.id ?? ''
    await call(
      api.answerCheckin,
      { params: { code: 'M1SHI', checkinId }, body: { response: 'still_available' } },
      asIs,
    )
    expect((await asAdoption('M1SHI')).pendingCheckin).toBeNull()
    later(14 * DAY + HOUR)
    expect((await asAdoption('M1SHI')).pendingCheckin).not.toBeNull()
  })

  it('a listing answers only `still_available`', async () => {
    await asCarolina()
    const error = await failure(
      call(
        api.answerCheckin,
        { params: { code: 'M1SHI', checkinId: 'ck-misha-1' }, body: { response: 'still_lost' } },
        asIs,
      ),
    )
    expect(error.code).toBe('validation_failed')
  })

  it('two unanswered check-ins archive it, the lister is told, and it reopens within 90 days', async () => {
    later(15 * DAY)
    await asCarolina()
    const misha = await asAdoption('M1SHI')
    expect([misha.status, misha.resolution]).toEqual(['expired', 'no_response'])
    expect(db.notifications.some((n) => n.event === 'adoption_case.expired')).toBe(true)
    // Expiry never changes who is responsible (01 · rule 7).
    expect(db.pets.find((p) => p.id === 'pet-misha')?.custody_state).toBe('unclaimed')
    later(60 * DAY)
    await call(api.reopenCase, { params: { code: 'M1SHI' } }, asIs)
    expect((await asAdoption('M1SHI')).status).toBe('active')
  })

  it('not after 90 days', async () => {
    later(15 * DAY)
    await asCarolina()
    later(91 * DAY)
    expect((await failure(call(api.reopenCase, { params: { code: 'M1SHI' } }, asIs))).code).toBe(
      'invalid_transition',
    )
  })
})

describe('adoption — publishing (06 · adoption_case; 05 · the day-15 conversion)', () => {
  // The demo account with its number already verified: these scenarios are not about the phone step.
  const asVerifiedCarolina = async () => {
    await asCarolina()
    db.persons.find((p) => p.id === DEMO_OWNER_ID_FOR_TESTS)!.phone = '+573000000000'
  }

  it('publishes a listing with the phone step, into the feed and the lister’s lists', async () => {
    await asNewcomer('ana.gomez@correo.co')
    const body = { ...listing, phone: '+573007152284' }
    expect(await call(api.publishAdoption, { body }, parsePublish)).toEqual({ kind: 'otp' })
    const published = await call(
      api.publishAdoption,
      { body: { ...body, otp_code: DEMO_CODE } },
      parsePublish,
    )
    if (published.kind !== 'published') throw new Error('expected a published listing')
    const pelusa = await asAdoption(published.code)
    expect([pelusa.viewer, pelusa.pet.healthFlags]).toEqual(['lister', ['fiv_felv']])
    const feed = await call(api.getFeed, { query: { vertical: 'adoption' } }, parseFeed)
    expect(feed.items[0]).toMatchObject({ code: published.code, detail: null })
    const mine = await call(api.listMyCases, {}, parseMyCases)
    expect(mine[0]).toMatchObject({ code: published.code, vertical: 'adoption' })
  })

  it('converts a found case at the day-15 offer: same pet, the found case `converted`', async () => {
    await asVerifiedCarolina()
    const body = {
      ...listing,
      from_found_case_code: 'C4STD',
      pet: { ...listing.pet, name: 'Tito', species: 'dog' as const },
    }
    const published = await call(api.publishAdoption, { body }, parsePublish)
    if (published.kind !== 'published') throw new Error('expected a published listing')
    const found = await caseOf('C4STD')
    if (found.vertical !== 'found') throw new Error('found')
    expect([found.status, found.successorCaseCode]).toEqual(['converted', published.code])
    const tito = await asAdoption(published.code)
    expect(tito.pet.name).toBe('Tito')
    expect(db.cases[published.code]).toMatchObject({ pet_id: 'pet-found-dog' })
    // Listing is not a transfer: the stray stays unclaimed and its custodian keeps it.
    expect(db.pets.find((p) => p.id === 'pet-found-dog')?.custody_state).toBe('unclaimed')
  })

  it('converts only the caller’s own found case, and only once the offer is due', async () => {
    await asVerifiedCarolina()
    const convert = (code: string) =>
      failure(call(api.publishAdoption, { body: { ...listing, from_found_case_code: code } }, asIs))
    expect((await convert('F8UND')).code).toBe('forbidden')
    Object.assign(db.cases.F8UND!, { created_by: DEMO_OWNER_ID_FOR_TESTS })
    expect((await convert('F8UND')).code).toBe('invalid_transition')
  })
})

/** The demo account with a verified number, as after its first publish. */
function carolinaHasAPhone() {
  const carolina = db.persons.find((p) => p.id === DEMO_OWNER_ID_FOR_TESTS)
  if (carolina) carolina.phone = '+573007152284'
}

describe('help — who sees what (07 · Identity ladder, help in kind)', () => {
  it('a stranger sees the needs and their progress, never who offered or their numbers', async () => {
    const request = await caseOf('HE7PA')
    if (request.vertical !== 'help') throw new Error('expected a help request')
    expect(request.viewer).toBe('public')
    expect(request.trustTier).toBe('unverified')
    expect(request.pledges).toEqual([])
    expect(request.needs.find((n) => n.kind === 'transport')).toMatchObject({
      confirmed: 0,
      pledged: 1,
    })
  })

  it('the beneficiary sees each pledge with a number to call', async () => {
    await asCarolina()
    const request = await caseOf('NA7LA')
    if (request.vertical !== 'help') throw new Error('expected a help request')
    expect(request.viewer).toBe('beneficiary')
    expect(request.pledges.map((p) => [p.personName, p.status, p.phone])).toEqual([
      ['Andrés R.', 'confirmed', '+573000000001'],
      ['Marcela T.', 'pledged', '+573000000008'],
    ])
  })

  it('no field anywhere carries money (decision #26)', async () => {
    const raw = JSON.stringify(await call(api.getCase, { params: { code: 'HE7PA' } }, asIs))
    expect(raw).not.toMatch(/amount|goal|raised|donat|payment|campaign/i)
  })
})

describe('help — «Yo ayudo» (07 · `help_pledge`)', () => {
  const pledge = (code: string, fields: Record<string, unknown> = {}) =>
    call(
      api.pledgeHelp,
      {
        params: { code },
        body: {
          need_id: 'need-max-home',
          quantity: 1,
          note: null,
          phone: null,
          phone_has_whatsapp: true,
          otp_code: null,
          ...fields,
        },
      },
      parsePledge,
    )

  it('needs an account', async () => {
    expect((await failure(pledge('HE7PA'))).kind).toBe('unauthorized')
  })

  it('needs a reachable number: a newcomer verifies one by SMS first', async () => {
    await asNewcomer('laura.diaz@correo.co')
    expect(await pledge('HE7PA', { phone: '+573001112233' })).toEqual({ kind: 'otp' })
    const sent = await pledge('HE7PA', { phone: '+573001112233', otp_code: DEMO_CODE })
    // The row first, then the channel: the beneficiary's WhatsApp.
    expect(sent).toMatchObject({ kind: 'sent', whatsappUrl: 'https://wa.me/573000000006' })
    const request = await caseOf('HE7PA')
    if (request.vertical !== 'help') throw new Error('expected a help request')
    expect(request.needs.find((n) => n.kind === 'foster')).toMatchObject({
      confirmed: 0,
      pledged: 1,
    })
    expect(request.myPledges).toMatchObject([{ needId: 'need-max-home', status: 'pledged' }])
  })

  it('tells the beneficiary someone offered', async () => {
    await asCarolina()
    carolinaHasAPhone()
    await pledge('HE7PA')
    const julian = db.notifications.filter((n) => n.person_id === 'user-julian')
    expect(julian.at(-1)?.body).toBe(
      'Carolina M. ofrece un hogar temporal para Max. Escríbele para coordinar.',
    )
  })

  it('the beneficiary never pledges to their own request', async () => {
    await asCarolina()
    const refused = await failure(pledge('NA7LA', { need_id: 'need-nala-home' }))
    expect(refused.code).toBe('forbidden')
  })

  it('a pledger withdraws an offer not yet confirmed, and only theirs', async () => {
    await asCarolina()
    carolinaHasAPhone()
    const sent = await pledge('HE7PA')
    if (sent.kind !== 'sent') throw new Error('expected a pledge')
    await call(api.withdrawPledge, { params: { code: 'HE7PA', pledgeId: sent.id } }, asIs)
    const request = await caseOf('HE7PA')
    if (request.vertical !== 'help') throw new Error('expected a help request')
    expect(request.needs.find((n) => n.kind === 'foster')?.pledged).toBe(0)
    const other = await failure(
      call(api.withdrawPledge, { params: { code: 'HE7PA', pledgeId: 'pl-max-ride' } }, asIs),
    )
    expect(other.code).toBe('forbidden')
  })
})

describe('help — only the beneficiary confirms (07 · Rules)', () => {
  const answer = (pledgeId: string, status: 'confirmed' | 'declined') =>
    call(api.answerPledge, { params: { code: 'NA7LA', pledgeId }, body: { status } }, asIs)

  it('a pledger cannot confirm their own help', async () => {
    await asNewcomer('marcela@correo.co')
    expect((await failure(answer('pl-nala-home', 'confirmed'))).code).toBe('forbidden')
  })

  it('a confirmation that reaches the target covers the need and thanks the pledger', async () => {
    await asCarolina()
    await answer('pl-nala-home', 'confirmed')
    const request = await caseOf('NA7LA')
    if (request.vertical !== 'help') throw new Error('expected a help request')
    expect(request.needs.find((n) => n.kind === 'foster')).toMatchObject({
      status: 'covered',
      confirmed: 1,
      pledged: 0,
    })
    // The sand still needs two bags: the request stays open.
    expect(request.status).toBe('active')
    const marcela = db.notifications.filter((n) => n.person_id === 'user-marcela')
    expect(marcela.at(-1)?.event).toBe('help_pledge.confirmed')
  })

  it('pledges alone never cover anything: a promise is not a ride', async () => {
    await asCarolina()
    await answer('pl-nala-home', 'declined')
    const request = await caseOf('NA7LA')
    if (request.vertical !== 'help') throw new Error('expected a help request')
    expect(request.needs.find((n) => n.kind === 'foster')).toMatchObject({
      status: 'open',
      confirmed: 0,
    })
    expect((await failure(answer('pl-nala-home', 'confirmed'))).code).toBe('invalid_transition')
  })

  it('every need covered closes the request as `covered`', async () => {
    await asCarolina()
    await answer('pl-nala-home', 'confirmed')
    await call(api.coverNeed, { params: { code: 'NA7LA', needId: 'need-nala-sand' } }, asIs)
    const request = await caseOf('NA7LA')
    expect(request).toMatchObject({ status: 'closed', resolution: 'covered' })
  })

  it('«ya no necesita ayuda» closes it and tells whoever still has an offer waiting', async () => {
    await asCarolina()
    await call(
      api.closeHelp,
      { params: { code: 'NA7LA' }, body: { resolution: 'need_ended' } },
      asIs,
    )
    expect(await caseOf('NA7LA')).toMatchObject({ status: 'closed', resolution: 'need_ended' })
    const marcela = db.notifications.filter((n) => n.person_id === 'user-marcela')
    expect(marcela.at(-1)?.event).toBe('help_request.closed')
    // Removal and closing touch only the request: Nala is still Carolina's.
    expect(db.pets.find((p) => p.id === 'pet-nala')?.owner_id).toBe(DEMO_OWNER_ID_FOR_TESTS)
  })
})

describe('help — the follow-up loop (07 · Cadence, soft expiry, 30-day reopen)', () => {
  it('asks «¿sigue?» a week after publishing, and «sí, sigue» resets the clock', async () => {
    await asCarolina()
    later(5 * DAY + HOUR)
    const asked = await caseOf('NA7LA')
    if (asked.vertical !== 'help' || !asked.pendingCheckin) throw new Error('expected a check-in')
    await call(
      api.answerCheckin,
      {
        params: { code: 'NA7LA', checkinId: asked.pendingCheckin.id },
        body: { response: 'still_needed' },
      },
      asIs,
    )
    const answered = await caseOf('NA7LA')
    expect(answered.vertical === 'help' && answered.pendingCheckin).toBe(null)
  })

  it('two unanswered questions archive it; the beneficiary reopens it within 30 days', async () => {
    await asCarolina()
    later(5 * DAY + 14 * DAY + 2 * DAY)
    expect(await caseOf('NA7LA')).toMatchObject({ status: 'expired', resolution: 'no_response' })
    await call(api.reopenCase, { params: { code: 'NA7LA' } }, asIs)
    expect(await caseOf('NA7LA')).toMatchObject({ status: 'active' })
  })

  it('a help check-in answers only «sigue»', async () => {
    await asCarolina()
    later(5 * DAY + HOUR)
    const asked = await caseOf('NA7LA')
    if (asked.vertical !== 'help' || !asked.pendingCheckin) throw new Error('expected a check-in')
    const refused = await failure(
      call(
        api.answerCheckin,
        {
          params: { code: 'NA7LA', checkinId: asked.pendingCheckin.id },
          body: { response: 'still_lost' },
        },
        asIs,
      ),
    )
    expect(refused.code).toBe('validation_failed')
  })
})

describe('help — endings and who hears of them (07 · Rules, Events; 08 · Help)', () => {
  it('a covered request reads closed to everyone, and takes no more offers', async () => {
    const request = await caseOf('CH5PA')
    if (request.vertical !== 'help') throw new Error('expected a help request')
    expect(request).toMatchObject({ status: 'closed', resolution: 'covered', viewer: 'public' })
    expect(request.needs).toMatchObject([{ status: 'covered', confirmed: 1, pledged: 0 }])
    await asNewcomer('laura.diaz@correo.co')
    const refused = await failure(
      call(
        api.pledgeHelp,
        {
          params: { code: 'CH5PA' },
          body: {
            need_id: 'need-chispa-ride',
            quantity: 1,
            note: null,
            phone: '+573001112233',
            phone_has_whatsapp: true,
            otp_code: DEMO_CODE,
          },
        },
        asIs,
      ),
    )
    expect(refused.code).toBe('invalid_transition')
  })

  it('a closed request leaves the feed; the open ones stay', async () => {
    const feed = await call(api.getFeed, { query: {} }, parseFeed)
    expect(feed.items.map((i) => i.code)).not.toContain('CH5PA')
    expect(feed.items.map((i) => i.code)).toEqual(expect.arrayContaining(['HE7PA', 'NA7LA']))
  })

  it('the pledger hears «llegó» in 08’s words', async () => {
    await asCarolina()
    await call(
      api.answerPledge,
      { params: { code: 'NA7LA', pledgeId: 'pl-nala-home' }, body: { status: 'confirmed' } },
      asIs,
    )
    const marcela = db.notifications.filter((n) => n.person_id === 'user-marcela')
    expect(marcela.at(-1)?.body).toBe('Llegó lo que ofreciste para Nala. Gracias.')
  })

  it('closing tells only offers still waiting — not whoever already delivered', async () => {
    await asCarolina()
    await call(
      api.closeHelp,
      { params: { code: 'NA7LA' }, body: { resolution: 'pet_deceased' } },
      asIs,
    )
    const told = (id: string) =>
      db.notifications.filter((n) => n.person_id === id && n.event === 'help_request.closed')
    expect(told('user-marcela').map((n) => n.body)).toEqual([
      'La solicitud de Nala ya no está activa. Gracias por ofrecer.',
    ])
    // Andrés's sand arrived and was confirmed: nothing of his is pending.
    expect(told('user-andres')).toEqual([])
    expect(
      db.checkins.filter((c) => c.case_code === 'NA7LA' && !c.cancelled_at && !c.responded_at),
    ).toEqual([])
  })

  it('archiving tells the beneficiary until when they can reopen it', async () => {
    await asCarolina()
    later(5 * DAY + 14 * DAY + 2 * DAY)
    await caseOf('NA7LA')
    const expired = db.notifications.filter(
      (n) => n.person_id === DEMO_OWNER_ID_FOR_TESTS && n.event === 'help_request.expired',
    )
    expect(expired).toHaveLength(1)
    expect(expired[0]?.body).toMatch(
      /^Archivamos la solicitud de ayuda de Nala\. Puedes reactivarla con un toque hasta el \d{1,2}\D+$/,
    )
  })

  it('reopening a case whose pet has another active case is `active_case_exists`', async () => {
    await asCarolina()
    const luna = db.cases['7K3PQ']
    if (luna?.vertical !== 'lost') throw new Error('expected lost')
    const other = Object.values(db.cases).find(
      (c) => c.vertical === 'lost' && c.code !== luna.code && c.status === 'active',
    )
    if (!other) throw new Error('need a second lost case')
    Object.assign(luna, {
      status: 'expired',
      resolved_at: new Date().toISOString(),
      pet_id: other.pet_id,
    })
    const refused = await failure(call(api.reopenCase, { params: { code: '7K3PQ' } }, asIs))
    expect(refused.code).toBe('active_case_exists')
    expect(luna.status).toBe('expired')
  })

  it('past the 30 days it cannot be reopened', async () => {
    await asCarolina()
    later(5 * DAY + 14 * DAY + 2 * DAY)
    expect(await caseOf('NA7LA')).toMatchObject({ status: 'expired' })
    later(31 * DAY)
    const refused = await failure(call(api.reopenCase, { params: { code: 'NA7LA' } }, asIs))
    expect(refused.code).toBe('invalid_transition')
  })

  it('a date that matters asks «¿sigue?» the day after it, before the week is out', async () => {
    await asCarolina()
    carolinaHasAPhone()
    const tomorrow = new Date(Date.now() + DAY).toISOString().slice(0, 10)
    const published = await call(
      api.publishHelp,
      {
        body: {
          pet_id: 'pet-nala',
          pet: null,
          needs: [
            { kind: 'transport', detail: 'Al control de mañana', target: 1, needed_by: tomorrow },
          ],
          story: 'Tiene control mañana y no tengo carro.',
          location_point: { lat: 6.2447, lng: -75.5916 },
          location_radius_m: 300,
          phone: null,
          phone_has_whatsapp: true,
          contact_prefs: { expose_whatsapp: true, expose_email: false, in_app_only: false },
          otp_code: null,
        },
      },
      parsePublish,
    )
    if (published.kind !== 'published') throw new Error('expected it published')
    const before = await caseOf(published.code)
    expect(before.vertical === 'help' && before.pendingCheckin).toBe(null)
    later(3 * DAY)
    const asked = await caseOf(published.code)
    expect(asked.vertical === 'help' && asked.pendingCheckin).toBeTruthy()
  })
})

describe('help — publishing (07 · Publishing)', () => {
  const body = (fields: Record<string, unknown> = {}) => ({
    pet_id: null,
    pet: {
      name: 'Pelusa',
      species: 'cat' as const,
      size: 'small' as const,
      colors: [],
      marks: null,
      photo_urls: [],
    },
    needs: [
      {
        kind: 'transport' as const,
        detail: 'Al veterinario el viernes',
        target: 1,
        needed_by: null,
      },
    ],
    story: 'Necesita ir al control y no tengo cómo llevarla.',
    location_point: { lat: 6.2447, lng: -75.5916 },
    location_radius_m: 300,
    phone: null,
    phone_has_whatsapp: true,
    contact_prefs: { expose_whatsapp: true, expose_email: false, in_app_only: false },
    otp_code: null,
    ...fields,
  })

  it('publishes at once, unverified, with the pet and its owner link created together', async () => {
    await asCarolina()
    await call(api.updateProfile, { body: { display_name: 'Carolina Mejía' } }, asIs).catch(
      () => undefined,
    )
    db.persons.find((p) => p.id === DEMO_OWNER_ID_FOR_TESTS)!.phone = '+573007152284'
    const published = await call(api.publishHelp, { body: body() }, parsePublish)
    if (published.kind !== 'published') throw new Error('expected it published')
    const request = await caseOf(published.code)
    expect(request).toMatchObject({ vertical: 'help', status: 'active', trustTier: 'unverified' })
    const pet = db.pets.find((p) => p.name === 'Pelusa')
    expect(pet).toMatchObject({ owner_id: DEMO_OWNER_ID_FOR_TESTS, custody_state: 'claimed' })
  })

  it('the custodian of a found case asks for its animal, named by what it looks like', async () => {
    await asCarolina()
    carolinaHasAPhone()
    const published = await call(
      api.publishHelp,
      { body: body({ pet: null, pet_id: null, from_case_code: 'C4STD' }) },
      parsePublish,
    )
    if (published.kind !== 'published') throw new Error('expected it published')
    expect(db.cases[published.code]?.pet_id).toBe(db.cases.C4STD?.pet_id)
    const request = await caseOf(published.code)
    expect(request.vertical === 'help' && request.pet.name).toBe('Perro café, mediano')
    // Someone else's found case is not theirs to ask for.
    expect(
      (
        await failure(
          call(api.publishHelp, { body: body({ pet: null, from_case_code: 'F8UND' }) }, asIs),
        )
      ).code,
    ).toBe('not_found')
  })

  it('carries its own evidence photos, shown after the pet’s (07 · photos[])', async () => {
    await asCarolina()
    carolinaHasAPhone()
    const published = await call(
      api.publishHelp,
      { body: body({ photo_urls: ['data:image/png;base64,VET'] }) },
      parsePublish,
    )
    if (published.kind !== 'published') throw new Error('expected it published')
    const request = await caseOf(published.code)
    expect(request.vertical === 'help' && request.photoUrls).toEqual(['data:image/png;base64,VET'])
    expect(
      (
        await failure(
          call(api.publishHelp, { body: body({ photo_urls: ['a', 'b', 'c', 'd'] }) }, asIs),
        )
      ).code,
    ).toBe('validation_failed')
  })

  it('only for a pet the beneficiary holds', async () => {
    await asCarolina()
    carolinaHasAPhone()
    const refused = await failure(
      call(api.publishHelp, { body: body({ pet_id: 'pet-max', pet: null }) }, asIs),
    )
    expect(refused.code).toBe('not_found')
  })

  it('one to three needs, each with a detail; no other kind exists', async () => {
    await asCarolina()
    const none = await failure(call(api.publishHelp, { body: body({ needs: [] }) }, asIs))
    expect(none.code).toBe('validation_failed')
    const money = await failure(
      call(
        api.publishHelp,
        {
          body: body({
            needs: [{ kind: 'money', detail: '500.000', target: null, needed_by: null }],
          }),
        },
        asIs,
      ),
    )
    expect(money.code).toBe('validation_failed')
  })
})

describe('the account (auth.md · Profile, 08 · inbox)', () => {
  it('edits the profile, and refuses links in the bio', async () => {
    await asCarolina()
    const profile = await call(api.updateProfile, { body: { city: 'Envigado' } }, parseProfile)
    expect(profile.city).toBe('Envigado')
    expect(
      (await failure(call(api.updateProfile, { body: { bio: 'Escríbeme a wa.me/57300' } }, asIs)))
        .code,
    ).toBe('validation_failed')
  })

  it('marks the inbox as read', async () => {
    await asCarolina()
    expect((await call(api.listNotifications, {}, parseNotifications)).unreadCount).toBe(3)
    await call(api.readNotifications, { body: { ids: null } }, asIs)
    expect((await call(api.listNotifications, {}, parseNotifications)).unreadCount).toBe(0)
  })
})

describe('one request, one transaction', () => {
  it('a request refused part-way leaves no trace', async () => {
    await asCarolina()
    // A claim check-in whose claim is gone: the check-in is marked answered first, then the claim
    // is not found and the whole request is undone.
    db.checkins.push({
      id: 'ck-due',
      case_code: '7K3PQ',
      claim_id: 'claim-missing',
      trigger: 'post_recovery_claim',
      scheduled_at: new Date(Date.now() - HOUR).toISOString(),
      responded_at: null,
      cancelled_at: null,
      response: null,
    })
    const error = await failure(
      call(
        api.answerCheckin,
        { params: { code: '7K3PQ', checkinId: 'ck-due' }, body: { response: 'claim_dismissed' } },
        asIs,
      ),
    )
    expect(error.code).toBe('not_found')
    expect(db.checkins.find((c) => c.id === 'ck-due')?.responded_at).toBeNull()
    expect((await caseOf('7K3PQ')).status).toBe('active')
  })
})

describe('the email’s one-tap links (comms.md · Actionable check-ins, The scanner rule)', () => {
  const openLink = (token: string) =>
    call(api.openCheckinLink, { params: { token } }, parseCheckinLink)
  const confirmLink = (token: string) =>
    call(api.confirmCheckinLink, { params: { token } }, parseCheckinLink)
  const checkinRow = (id: string) => db.checkins.find((c) => c.id === id)
  const asJulian = () =>
    call(api.verifyEmailCode, { body: { email: 'julian@correo.co', code: DEMO_CODE } }, parseUser)
  const miloQuestion = async () => {
    const milo = await caseOf('M2TQ4')
    return milo.vertical === 'lost' ? milo.pendingCheckin : 'not a lost case'
  }
  const pendingOn = async (code: string) =>
    (await call(api.listMyCases, {}, parseMyCases)).find((c) => c.code === code)?.pendingCheckinAt

  it('a safe answer acts on the GET, without a session, and thanks', async () => {
    const link = await openLink(DEMO_LINKS.mishaStillAvailable)
    expect(link).toMatchObject({
      caseCode: 'M1SHI',
      vertical: 'adoption',
      petName: 'Misha',
      response: 'still_available',
      kind: 'safe',
      state: 'applied',
    })
    expect(checkinRow('ck-misha-1')).toMatchObject({ response: 'still_available' })
    expect(db.cases.M1SHI?.status).toBe('active')
  })

  it('a consequential answer never acts on the GET: a scanner’s prefetch changes nothing', async () => {
    for (let i = 0; i < 3; i++) {
      const link = await openLink(DEMO_LINKS.miloReunited)
      expect(link).toMatchObject({ kind: 'consequential', state: 'confirm' })
      // Backing out is the same email's safe button.
      expect(link.declineToken).toBe(DEMO_LINKS.miloStillLost)
    }
    expect(checkinRow('ck-milo-1')?.responded_at).toBeNull()
    expect((await caseOf('M2TQ4')).status).toBe('active')
  })

  it('the confirm page’s POST applies it, with the defaults the app would ask for', async () => {
    const link = await confirmLink(DEMO_LINKS.miloReunited)
    expect(link.state).toBe('applied')
    expect(checkinRow('ck-milo-1')?.response).toBe('reunited')
    expect((await caseOf('M2TQ4')).status).toBe('reunited')
    expect(db.cases.M2TQ4).toMatchObject({ resolution_attribution: 'unknown' })
  })

  it('a link is single-use: opening or confirming it again changes nothing', async () => {
    await confirmLink(DEMO_LINKS.miloReunited)
    expect((await openLink(DEMO_LINKS.miloReunited)).state).toBe('used')
    expect((await confirmLink(DEMO_LINKS.miloReunited)).state).toBe('used')
    await openLink(DEMO_LINKS.mishaStillAvailable)
    const answeredAt = checkinRow('ck-misha-1')?.responded_at
    later(HOUR)
    expect((await openLink(DEMO_LINKS.mishaStillAvailable)).state).toBe('used')
    expect(checkinRow('ck-misha-1')?.responded_at).toBe(answeredAt)
  })

  it('answered anywhere = answered everywhere: the other buttons stop acting', async () => {
    await asJulian()
    await call(
      api.answerCheckin,
      { params: { code: 'M2TQ4', checkinId: 'ck-milo-1' }, body: { response: 'still_lost' } },
      asIs,
    )
    signOut()
    expect((await openLink(DEMO_LINKS.miloReunited)).state).toBe('already_answered')
    expect((await confirmLink(DEMO_LINKS.miloReunited)).state).toBe('already_answered')
    expect((await caseOf('M2TQ4')).status).toBe('active')
    // The app's answer was «sigue perdida»: that button reads as already used.
    expect((await openLink(DEMO_LINKS.miloStillLost)).state).toBe('used')
  })

  it('answering through the link closes the question in the app and on home', async () => {
    await asJulian()
    expect(await pendingOn('M2TQ4')).toBeInstanceOf(Date)
    expect(await miloQuestion()).toMatchObject({ id: 'ck-milo-1' })
    await openLink(DEMO_LINKS.miloStillLost)
    expect(await pendingOn('M2TQ4')).toBeNull()
    expect(await miloQuestion()).toBeNull()
  })

  it('a link expires a week after its email went out, and then acts no more', async () => {
    // Misha's check-in fell due a day ago; its email went out with the 24 h escalation.
    later(7 * DAY - HOUR)
    expect((await openLink(DEMO_LINKS.miloReunited)).state).not.toBe('expired')
    later(2 * HOUR)
    expect((await openLink(DEMO_LINKS.mishaStillAvailable)).state).toBe('expired')
    expect((await confirmLink(DEMO_LINKS.mishaStillAvailable)).state).toBe('expired')
    expect(checkinRow('ck-misha-1')?.responded_at).toBeNull()
  })

  it('«ya fue adoptado» ends the listing, with the person «En proceso» as the adopter', async () => {
    const interest = db.adoptionInterests.find((i) => i.case_code === 'M1SHI')!
    interest.status = 'chosen'
    const token = linkToken('ck-misha-1', 'adopted')
    expect((await openLink(token)).state).toBe('confirm')
    expect(db.cases.M1SHI?.status).toBe('active')
    expect((await confirmLink(token)).state).toBe('applied')
    expect(db.cases.M1SHI).toMatchObject({ status: 'adopted', resolution: 'adopted_in_app' })
  })

  it('the demo buttons are stable: e2e/pages/EmailLinkPage.ts opens them by these values', () => {
    expect(DEMO_LINKS).toMatchObject({
      mishaStillAvailable: '1d6wc5o0mddvnj',
      miloReunited: '1sl8znh06absty',
    })
  })

  it('an unknown token, or one for a question not asked yet, is not found', async () => {
    expect((await failure(openLink('not-a-token'))).code).toBe('not_found')
    // Luna's next «¿sigue perdida?» falls due tomorrow: no email, so no link.
    expect((await failure(openLink(linkToken('ck-luna-1', 'still_lost')))).code).toBe('not_found')
    expect((await failure(confirmLink('not-a-token'))).code).toBe('not_found')
  })
})

describe('the in-app chat (comms.md · Twilio Conversations)', () => {
  const list = () => call(api.listConversations, {}, parseConversations)
  const open = (id: string) => call(api.getConversation, { params: { id } }, parseConversation)

  it('lists the account’s threads: unread first-hand, the closed one last, never a number', async () => {
    await asCarolina()
    const { items, unreadCount } = await list()
    expect(items.map((i) => i.id)).toEqual([
      'conv-andres-misha',
      'conv-andres-dog',
      'conv-marcela-canela',
    ])
    expect(unreadCount).toBe(2)
    expect(items.at(-1)).toMatchObject({ closed: true, otherName: 'Marcela T.' })
    expect(JSON.stringify(items)).not.toMatch(/\+57/)
  })

  it('opening a thread shows its messages oldest first and the case card; reading clears the count', async () => {
    await asCarolina()
    const thread = await open('conv-andres-dog')
    expect(thread.case).toMatchObject({ code: 'C4STD', vertical: 'found' })
    expect(thread.messages.map((m) => m.kind)).toEqual(['automatic', 'text'])
    expect(thread.messages[0]?.label).toBe('Mensaje automático · evidencia de «Es mío»')
    await call(api.readConversation, { params: { id: 'conv-andres-dog' } }, asIs)
    expect((await list()).unreadCount).toBe(1)
  })

  it('only the two people in it can open or write', async () => {
    await asCarolina()
    db.conversations[0]!.other_id = 'user-sofia'
    expect((await failure(open('conv-andres-dog'))).code).toBe('forbidden')
    expect((await failure(open('conv-nope'))).code).toBe('not_found')
  })

  it('sends a message, and reading it makes the thread read for the sender', async () => {
    await asCarolina()
    const sent = await call(
      api.sendMessage,
      { params: { id: 'conv-andres-dog' }, body: { body: '  Hola Andrés  ' } },
      (raw) => raw as { mine: boolean; body: string },
    )
    expect(sent).toMatchObject({ mine: true, body: 'Hola Andrés' })
    expect((await open('conv-andres-dog')).messages.at(-1)?.body).toBe('Hola Andrés')
  })

  it('a closed conversation is read-only and final', async () => {
    await asCarolina()
    const closed = await open('conv-marcela-canela')
    expect(closed.closed?.note).toBe('Pasó a adopción')
    expect(closed.canShareWhatsapp).toBe(false)
    expect(
      (
        await failure(
          call(
            api.sendMessage,
            { params: { id: 'conv-marcela-canela' }, body: { body: 'Hola' } },
            asIs,
          ),
        )
      ).code,
    ).toBe('invalid_transition')
  })

  it('«Dar mi WhatsApp» needs a verified number and is given once', async () => {
    await asCarolina()
    expect(
      (await failure(call(api.shareWhatsapp, { params: { id: 'conv-andres-misha' } }, asIs))).code,
    ).toBe('phone_required')
    carolinaHasAPhone()
    expect((await open('conv-andres-misha')).canShareWhatsapp).toBe(true)
    await call(api.shareWhatsapp, { params: { id: 'conv-andres-misha' } }, asIs)
    const after = await open('conv-andres-misha')
    expect(after.canShareWhatsapp).toBe(false)
    expect(after.messages.at(-1)).toMatchObject({ kind: 'whatsapp', mine: true })
    expect(
      (await failure(call(api.shareWhatsapp, { params: { id: 'conv-andres-misha' } }, asIs))).code,
    ).toBe('invalid_transition')
  })

  it('writing from a case creates the thread with its first message, and a second answers the same one', async () => {
    await asCarolina()
    const first = await call(
      api.startConversation,
      { params: { code: 'F8UND' }, body: { body: 'Creo que es mi gato' } },
      parseStarted,
    )
    const again = await call(
      api.startConversation,
      { params: { code: 'F8UND' }, body: { body: 'Sigo aquí' } },
      parseStarted,
    )
    expect(again.id).toBe(first.id)
    expect((await open(first.id)).messages.map((m) => m.body)).toEqual([
      'Creo que es mi gato',
      'Sigo aquí',
    ])
  })

  it('never on your own case, nor on one that ended', async () => {
    await asCarolina()
    const body = { body: 'Hola' }
    expect(
      (await failure(call(api.startConversation, { params: { code: 'C4STD' }, body }, asIs))).code,
    ).toBe('forbidden')
    expect(
      (await failure(call(api.startConversation, { params: { code: 'R3SCU' }, body }, asIs))).code,
    ).toBe('invalid_transition')
    expect(
      (await failure(call(api.startConversation, { params: { code: 'NOPE1' }, body }, asIs))).code,
    ).toBe('not_found')
  })
})

describe('your own sighting (04 · Second pin, Correction window)', () => {
  const pin = { lat: 6.2455, lng: -75.5905 }
  const send = (fields: Record<string, unknown> = {}) =>
    call(
      api.reportSighting,
      {
        params: { code: '7K3PQ' },
        body: {
          point: pin,
          seen_at: new Date().toISOString(),
          note: null,
          contact_phone: null,
          ...fields,
        },
      },
      (raw) => (raw as { id: string }).id,
    )
  const luna = async () => {
    const found = await caseOf('7K3PQ')
    if (found.vertical !== 'lost') throw new Error('expected lost')
    return found
  }
  const correct = (id: string, fields: Record<string, unknown> = {}) =>
    call(
      api.correctSighting,
      {
        params: { code: '7K3PQ', sightingId: id },
        body: {
          point: { lat: 6.2461, lng: -75.5899 },
          seen_at: new Date().toISOString(),
          note: 'Más acá',
          ...fields,
        },
      },
      asIs,
    )

  it('marks the pin as yours for fifteen minutes, and no one else’s', async () => {
    const id = await send()
    const own = (await luna()).sightings.find((s) => s.id === id)
    expect(own?.mine).toBe(true)
    expect(own?.editableUntil?.getTime()).toBe(Date.now() + 15 * 60_000)
    const others = (await luna()).sightings.filter((s) => s.id !== id)
    expect(others.every((s) => !s.mine && s.editableUntil === null)).toBe(true)
  })

  it('a stranger on another device sees none of them as theirs', async () => {
    const id = await send()
    db.sightings.find((s) => s.id === id)!.reporter_key = 'device-someone-else'
    expect((await luna()).sightings.every((s) => !s.mine)).toBe(true)
  })

  it('«Corregir» moves the pin: same id, no new row, the checks run again', async () => {
    const id = await send()
    const before = (await luna()).sightings.length
    await correct(id)
    const after = await luna()
    expect(after.sightings).toHaveLength(before)
    expect(after.sightings.find((s) => s.id === id)).toMatchObject({
      point: { lat: 6.2461, lng: -75.5899 },
      note: 'Más acá',
    })
    expect((await failure(correct(id, { point: { lat: 7.5, lng: -75.5 } }))).code).toBe(
      'sighting_too_far',
    )
  })

  it('past the window it is part of the record: neither correct nor delete', async () => {
    const id = await send()
    later(16 * 60_000)
    expect((await failure(correct(id))).code).toBe('forbidden')
    expect(
      (await failure(call(api.deleteSighting, { params: { code: '7K3PQ', sightingId: id } }, asIs)))
        .code,
    ).toBe('forbidden')
    expect((await luna()).sightings.find((s) => s.id === id)?.editableUntil).toBeNull()
  })

  it('deleting takes the pin off the case', async () => {
    const id = await send()
    await call(api.deleteSighting, { params: { code: '7K3PQ', sightingId: id } }, asIs)
    expect((await luna()).sightings.some((s) => s.id === id)).toBe(false)
  })

  it('someone else’s pin is not yours to change', async () => {
    const other = db.sightings.find((s) => s.case_code === '7K3PQ')!
    expect((await failure(correct(other.id))).code).toBe('forbidden')
    expect(
      (
        await failure(
          call(api.deleteSighting, { params: { code: '7K3PQ', sightingId: other.id } }, asIs),
        )
      ).code,
    ).toBe('forbidden')
    expect((await failure(correct('s-nope'))).code).toBe('not_found')
  })
})

describe('«Mascotas perdidas cerca de mí» (08)', () => {
  const get = () => call(api.getNearbyAlerts, {}, parseNearbyAlerts)
  const set = (body: {
    enabled: boolean
    center: { lat: number; lng: number } | null
    radius_km: 1 | 2 | 5
  }) => call(api.setNearbyAlerts, { body }, parseNearbyAlerts)
  const laureles = { lat: 6.2447, lng: -75.5916 }

  it('is off until a zone is confirmed, and needs an account', async () => {
    expect((await failure(call(api.getNearbyAlerts, {}, asIs))).code).toBe('unauthorized')
    await asCarolina()
    expect(await get()).toMatchObject({
      enabled: false,
      center: null,
      radiusKm: 2,
      placeName: null,
    })
  })

  it('turns on with a point and a radius, and names the neighbourhood', async () => {
    await asCarolina()
    const on = await set({ enabled: true, center: laureles, radius_km: 5 })
    expect(on).toMatchObject({ enabled: true, radiusKm: 5, center: laureles })
    expect(on.placeName).toBeTruthy()
    expect(await get()).toEqual(on)
  })

  it('cannot be on without a place', async () => {
    await asCarolina()
    expect((await failure(set({ enabled: true, center: null, radius_km: 2 }))).code).toBe(
      'validation_failed',
    )
  })

  it('turning it off keeps the zone for next time', async () => {
    await asCarolina()
    await set({ enabled: true, center: laureles, radius_km: 1 })
    const off = await set({ enabled: false, center: laureles, radius_km: 1 })
    expect(off).toMatchObject({ enabled: false, center: laureles, radiusKm: 1 })
  })
})

describe('editing a published lost case (04)', () => {
  const edit = (body: Record<string, unknown>, code = '7K3PQ') =>
    call(api.editLost, { params: { code }, body }, asIs)
  const luna = async () => {
    const found = await caseOf('7K3PQ')
    if (found.vertical !== 'lost') throw new Error('expected lost')
    return found
  }

  it('the owner corrects the signs, the photos and where and when it was last seen', async () => {
    await asCarolina()
    await edit({
      marks: 'Collar azul',
      photo_urls: ['data:image/png;base64,AAAA'],
      last_seen_point: { lat: 6.25, lng: -75.58 },
      last_seen_radius_m: 500,
      last_seen_at: new Date(Date.now() - 3 * HOUR).toISOString(),
    })
    const after = await luna()
    expect(after.pet.marks).toBe('Collar azul')
    expect(after.pet.photoUrls).toEqual(['data:image/png;base64,AAAA'])
    expect(after.lastSeen).toMatchObject({ radiusM: 500, center: { lat: 6.25, lng: -75.58 } })
  })

  it('fields left out stay as they are, and it tells no one', async () => {
    await asCarolina()
    const before = await luna()
    const sent = db.notifications.length
    await edit({ marks: null })
    const after = await luna()
    expect(after.pet.marks).toBeNull()
    expect(after.lastSeen).toEqual(before.lastSeen)
    expect(db.notifications).toHaveLength(sent)
  })

  it('only the owner, only while the case is active', async () => {
    expect((await failure(edit({ marks: 'x' }))).code).toBe('unauthorized')
    await asCarolina()
    expect((await failure(edit({ marks: 'x' }, 'M2TQ4'))).code).toBe('forbidden')
    expect((await failure(edit({ marks: 'x' }, 'NOPE1'))).code).toBe('not_found')
    handTo('M2TQ4', DEMO_OWNER_ID_FOR_TESTS, { status: 'reunited' })
    expect((await failure(edit({ marks: 'x' }, 'M2TQ4'))).code).toBe('invalid_transition')
  })

  it('a time in the future is refused', async () => {
    await asCarolina()
    expect(
      (await failure(edit({ last_seen_at: new Date(Date.now() + DAY).toISOString() }))).code,
    ).toBe('validation_failed')
  })
})

describe('editing a found, adoption or help case (00 · #27)', () => {
  const edit = (code: string, body: Record<string, unknown>) =>
    call(api.editCase, { params: { code }, body }, asIs)
  const photo = ['data:image/png;base64,AAAA']

  it('the adoption lister corrects photos, story, temperament and requirements', async () => {
    await asCarolina()
    await edit('M1SHI', {
      photo_urls: photo,
      story: 'Nueva historia',
      temperament: ['puppy'],
      requirements: 'Patio',
    })
    expect(db.cases.M1SHI).toMatchObject({
      story: 'Nueva historia',
      temperament: ['puppy'],
      requirements: 'Patio',
    })
    expect(db.pets.find((p) => p.id === db.cases.M1SHI!.pet_id)?.photo_urls).toEqual(photo)
  })

  it('the found custodian corrects photos and signs; a story is not theirs to edit', async () => {
    await asCarolina()
    await edit('C4STD', { marks: 'Collar verde', photo_urls: photo })
    expect(db.pets.find((p) => p.id === db.cases.C4STD!.pet_id)?.marks).toBe('Collar verde')
    expect((await failure(edit('C4STD', { story: 'x' }))).code).toBe('validation_failed')
  })

  it('the help beneficiary corrects the story; temperament is for adoption only', async () => {
    await asCarolina()
    await edit('NA7LA', { story: 'Ya tiene visita al veterinario.' })
    expect(db.cases.NA7LA).toMatchObject({ story: 'Ya tiene visita al veterinario.' })
    expect((await failure(edit('NA7LA', { temperament: ['puppy'] }))).code).toBe(
      'validation_failed',
    )
  })

  it('tells no one: no notification, no new rows', async () => {
    await asCarolina()
    const sent = db.notifications.length
    await edit('M1SHI', { story: 'Otra' })
    expect(db.notifications).toHaveLength(sent)
  })

  it('only the publisher, only while active, and not a lost case', async () => {
    expect((await failure(edit('M1SHI', { story: 'x' }))).code).toBe('unauthorized')
    await asCarolina()
    expect((await failure(edit('AD9PT', { story: 'x' }))).code).toBe('forbidden')
    expect((await failure(edit('7K3PQ', { story: 'x' }))).code).toBe('not_found')
    expect((await failure(edit('NOPE1', { story: 'x' }))).code).toBe('not_found')
    db.cases.M1SHI!.status = 'withdrawn' as never
    expect((await failure(edit('M1SHI', { story: 'x' }))).code).toBe('invalid_transition')
  })
})

describe('deleting the account (O15, D14)', () => {
  const remove = () => call(api.deleteAccount, {}, asIs)

  it('closes the active cases, withdraws offers, erases what is personal and ends the session', async () => {
    await asCarolina()
    await remove()
    expect(db.persons.some((p) => p.id === DEMO_OWNER_ID_FOR_TESTS)).toBe(false)
    expect(db.cases['7K3PQ']?.status).toBe('cancelled')
    expect(db.cases.M1SHI?.status).toBe('withdrawn')
    expect(db.cases.NA7LA?.status).toBe('closed')
    expect(db.notifications.some((n) => n.person_id === DEMO_OWNER_ID_FOR_TESTS)).toBe(false)
    expect(
      db.conversations.some((c) => [c.started_by, c.other_id].includes(DEMO_OWNER_ID_FOR_TESTS)),
    ).toBe(false)
    expect((await failure(call(api.getSession, {}, asIs))).code).toBe('unauthorized')
  })

  it('what the person gave other cases stays, without their name', async () => {
    signIn(db.persons.find((p) => p.id === 'user-andres')!)
    const mine = db.sightings.filter((s) => s.reporter_id === 'user-andres').length
    expect(mine).toBeGreaterThan(0)
    await remove()
    expect(db.sightings.filter((s) => s.reporter_id === 'user-andres')).toHaveLength(0)
    expect(db.sightings.filter((s) => s.reporter_id === null).length).toBeGreaterThanOrEqual(mine)
    expect(
      db.adoptionInterests.filter((i) => i.person_id === 'user-andres' && i.status === 'open'),
    ).toHaveLength(0)
  })

  it('needs an account', async () => {
    expect((await failure(remove())).code).toBe('unauthorized')
  })
})

describe('the thread a claim or an interest opens (comms.md · created with its first message)', () => {
  it('«Es mío» opens a thread with the evidence as its first, automatic message', async () => {
    await asNewcomer('laura@correo.co')
    await call(
      api.claimOwnership,
      {
        params: { code: 'F8UND' },
        body: { evidence_notes: 'Mancha blanca en la pata', chip_number: null, photo_urls: [] },
      },
      asIs,
    )
    const thread = db.conversations.find((c) => c.case_code === 'F8UND')!
    expect(thread.other_id).toBe('user-marcela')
    const [first] = db.messages.filter((m) => m.conversation_id === thread.id)
    expect(first).toMatchObject({ kind: 'automatic', sender_id: null })
    expect(first?.body).toContain('Mancha blanca en la pata')
  })

  it('«Me interesa» opens one with the introduction; asking again does not start another', async () => {
    await asNewcomer('laura@correo.co')
    carolinaHasAPhone()
    const interest = {
      phone: '+573001112233',
      phone_has_whatsapp: true,
      otp_code: '123456',
      intro: {
        housing: 'house' as const,
        has_yard: true,
        other_pets: null,
        household: null,
        why: 'Tengo patio y tiempo.',
      },
    }
    await call(api.expressInterest, { params: { code: 'AD9PT' }, body: interest }, asIs)
    await call(api.expressInterest, { params: { code: 'AD9PT' }, body: interest }, asIs)
    const threads = db.conversations.filter((c) => c.case_code === 'AD9PT')
    expect(threads).toHaveLength(1)
    expect(db.messages.find((m) => m.conversation_id === threads[0]!.id)?.body).toBe(
      'Tengo patio y tiempo.',
    )
  })
})

describe('the profile: photo and changing the phone (auth.md · Profile, Phone)', () => {
  it('changes the phone only after the SMS code', async () => {
    await asCarolina()
    await call(api.startPhoneChange, { body: { phone: '+573009998877' } }, asIs)
    expect((await call(api.getProfile, {}, parseProfile)).phone).toBeNull()
    expect(
      (
        await failure(
          call(api.verifyPhoneChange, { body: { phone: '+573009998877', code: '000000' } }, asIs),
        )
      ).code,
    ).toBe('invalid_code')
    const profile = await call(
      api.verifyPhoneChange,
      { body: { phone: '+573009998877', code: DEMO_CODE } },
      parseProfile,
    )
    expect(profile.phone).toBe('+573009998877')
    expect((await call(api.getSession, {}, parseUser)).phone).toBe('+573009998877')
  })

  it('sets and removes the photo', async () => {
    await asCarolina()
    const set = await call(
      api.updateProfile,
      { body: { photo_url: 'data:image/png;base64,AAAA' } },
      parseProfile,
    )
    expect(set.photoUrl).toBe('data:image/png;base64,AAAA')
    const cleared = await call(api.updateProfile, { body: { photo_url: null } }, parseProfile)
    expect(cleared.photoUrl).toBeNull()
  })
})

describe('the custodian’s follow-up loop (05 · The follow-up loop, Schedule)', () => {
  const dog = async () => {
    const found = await caseOf('C4STD')
    if (found.vertical !== 'found') throw new Error('expected found')
    return found
  }

  it('the custodian sees «¿sigues con él?» when it is due; a stranger never does', async () => {
    expect((await dog()).pendingCheckin).toBeNull()
    await asCarolina()
    expect((await dog()).pendingCheckin?.id).toBe('ck-dog-1')
  })

  it('«Sigo con él» answers it and the next one comes five days later', async () => {
    await asCarolina()
    await call(
      api.answerCheckin,
      { params: { code: 'C4STD', checkinId: 'ck-dog-1' }, body: { response: 'still_holding' } },
      asIs,
    )
    expect((await dog()).pendingCheckin).toBeNull()
    later(5 * DAY + HOUR)
    expect((await dog()).pendingCheckin).not.toBeNull()
  })

  it('a found case only takes «sigo con él» as a one-tap answer', async () => {
    await asCarolina()
    expect(
      (
        await failure(
          call(
            api.answerCheckin,
            { params: { code: 'C4STD', checkinId: 'ck-dog-1' }, body: { response: 'still_lost' } },
            asIs,
          ),
        )
      ).code,
    ).toBe('validation_failed')
  })

  it('two unanswered in a row archive the case softly, and the custodian is told', async () => {
    later(6 * DAY)
    await asCarolina()
    expect((await dog()).status).toBe('expired')
    expect(db.notifications.some((n) => n.event === 'found_case.expired')).toBe(true)
  })

  it('a newly published found case asks first after 48 hours', async () => {
    await asCarolina()
    const before = db.checkins.length
    await call(
      api.publishFound,
      {
        body: {
          pet: {
            species: 'cat',
            size: 'small',
            colors: ['white'],
            marks: null,
            photo_urls: ['data:image/png;base64,AAAA'],
          },
          found_point: { lat: 6.2447, lng: -75.5916 },
          found_radius_m: 200,
          found_at: new Date().toISOString(),
          holding_where: 'home',
          withheld_detail: null,
          phone: '+573001112233',
          phone_has_whatsapp: true,
          contact_prefs: { expose_whatsapp: true, expose_email: false, in_app_only: false },
          otp_code: DEMO_CODE,
        },
      },
      asIs,
    )
    const added = db.checkins.slice(before)
    expect(added).toHaveLength(1)
    expect(new Date(added[0]!.scheduled_at).getTime() - Date.now()).toBe(48 * HOUR)
  })
})

describe('«La tengo» on an archived case (decision #29, closes O3)', () => {
  const claim = (code: string) =>
    call(api.claimRecovery, { params: { code }, body: { phone: '+573114829017' } }, asIs)

  it('reactivates a case archived less than 30 days ago, and tells the owner', async () => {
    await asNewcomer('pedro.ruiz@correo.co')
    await claim('ARCH2')
    expect(db.cases.ARCH2).toMatchObject({ status: 'active', resolution: null })
    expect(db.recoveryClaims.some((c) => c.case_code === 'ARCH2')).toBe(true)
    expect(db.notifications.at(-1)?.event).toBe('recovery_claim.opened')
  })

  it('a case archived longer ago, or closed, takes no claim', async () => {
    await asNewcomer('pedro.ruiz@correo.co')
    db.cases.ARCH2!.resolved_at = new Date(Date.now() - 31 * DAY).toISOString()
    expect((await failure(claim('ARCH2'))).code).toBe('invalid_transition')
    expect((await failure(claim('H4PPY'))).code).toBe('invalid_transition')
  })
})

describe('`share.opened` (10 §5)', () => {
  it('records the channel and format of a share, with or without an account', async () => {
    await call(
      api.recordShare,
      { params: { code: '7k3pq' }, body: { channel: 'whatsapp', format: 'text' } },
      asIs,
    )
    expect(db.shares.at(-1)).toMatchObject({
      case_code: '7K3PQ',
      channel: 'whatsapp',
      format: 'text',
    })
  })

  it('an unknown code is ignored, not refused', async () => {
    const before = db.shares.length
    await call(
      api.recordShare,
      { params: { code: 'NOPE1' }, body: { channel: 'system', format: 'story' } },
      asIs,
    )
    expect(db.shares).toHaveLength(before)
  })
})

describe('the date a case archives on (04 · case_checkin)', () => {
  it('a time-based question says when: the next one a cadence later, plus its escalation', async () => {
    await asCarolina()
    handTo('M2TQ4', DEMO_OWNER_ID_FOR_TESTS)
    const milo = await caseOf('M2TQ4')
    if (milo.vertical !== 'lost' || !milo.pendingCheckin) throw new Error('expected a question')
    expect(milo.pendingCheckin.archivesAt?.getTime()).toBe(
      milo.pendingCheckin.askedAt.getTime() + 7 * DAY + DAY,
    )
  })

  it('a claim question archives nothing', async () => {
    await asCarolina()
    db.checkins = db.checkins.filter((c) => c.claim_id !== null || c.case_code !== '7K3PQ')
    db.checkins.find((c) => c.id === 'ck-luna-claim-1')!.scheduled_at = new Date(
      Date.now() - HOUR,
    ).toISOString()
    const luna = await caseOf('7K3PQ')
    if (luna.vertical !== 'lost') throw new Error('expected lost')
    expect(luna.pendingCheckin?.trigger).toBe('post_recovery_claim')
    expect(luna.pendingCheckin?.archivesAt).toBeNull()
  })
})

describe('the demo account comes back (emulation)', () => {
  it('«Continuar con Google» after deleting it signs into a new, empty account', async () => {
    await asCarolina()
    await call(api.deleteAccount, {}, asIs)
    const again = await asCarolina()
    expect(again.email).toBe('carolina@correo.co')
    expect((await call(api.listMyCases, {}, parseMyCases)).length).toBe(0)
  })
})

describe('photo uploads (docs/eng/api.md · Uploads, media-pipeline §1)', () => {
  const sha256 = 'b'.repeat(64)
  const slot = () =>
    call(api.uploadPhoto, { body: uploadBody({ purpose: 'pet', sha256, bytes: 3 }) }, parseUpload)

  it('answers a slot to send the bytes to, and the URL the photo will have', async () => {
    const { url, target } = await slot()
    expect(url).toContain(sha256)
    expect(target?.url).toBe(url)
    expect(target?.headers['content-type']).toBe('image/jpeg')
  })

  it('serves the photo once the bytes are sent, and answers no slot for a photo it has', async () => {
    const { url, target } = await slot()
    expect((await fetch(url)).status).toBe(404)
    const put = await fetch(target?.url ?? '', {
      method: 'PUT',
      headers: target?.headers,
      body: new Uint8Array([1, 2, 3]),
    })
    expect(put.ok).toBe(true)
    const stored = await fetch(url)
    expect(new Uint8Array(await stored.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))
    expect((await slot()).target).toBeNull()
  })

  it('refuses a hash that is not a SHA-256', async () => {
    const error = await failure(
      call(
        api.uploadPhoto,
        { body: uploadBody({ purpose: 'pet', sha256: 'nope', bytes: 3 }) },
        asIs,
      ),
    )
    expect(error.code).toBe('validation_failed')
  })
})

describe('«Lo tengo» (04 · recovery_claim; decisions #75, #76)', () => {
  const claim = (code: string) =>
    call(
      api.claimRecovery,
      { params: { code }, body: { phone: '+573001112233' } },
      asIs,
    ) as Promise<{
      id: string
      whatsapp_url: string | null
    }>

  it('needs a session', async () => {
    expect((await failure(claim('7K3PQ'))).code).toBe('unauthorized')
  })

  it('the owner cannot claim their own case', async () => {
    await asCarolina()
    expect((await failure(claim('7K3PQ'))).code).toBe('forbidden')
  })

  it('a purged code is `gone`', async () => {
    await asNewcomer('pedro.ruiz@correo.co')
    expect((await failure(claim('GONE5'))).code).toBe('gone')
  })

  it('the WhatsApp link carries the backend text, encoded like URLEncoder with %20 for spaces', async () => {
    await asNewcomer('pedro.ruiz@correo.co')
    const row = db.cases['7K3PQ']
    if (row?.vertical !== 'lost') throw new Error('lost')
    const pet = db.pets.find((p) => p.id === row.pet_id)
    if (!pet) throw new Error('pet')
    pet.name = "Luna (la 'ñ'!)"
    const url = (await claim('7K3PQ')).whatsapp_url
    expect(url).toBe(
      `https://wa.me/${row.contact_phone.replace('+', '')}?text=` +
        'Hola%2C%20vi%20tu%20aviso%20de%20Luna%20%28la%20%27%C3%B1%27%21%29%20en%20' +
        encodeURIComponent(brand.name) +
        '%20%287K3PQ%29%20y%20creo%20que%20lo%20tengo.',
    )
  })

  it('the link follows the public-contact rule: no WhatsApp, no link; in-app only, no link', async () => {
    await asNewcomer('pedro.ruiz@correo.co')
    const row = db.cases['7K3PQ']
    if (row?.vertical !== 'lost') throw new Error('lost')
    row.contact_prefs = { expose_whatsapp: true, expose_email: false, in_app_only: true }
    expect((await claim('7K3PQ')).whatsapp_url).toBeNull()
    row.contact_prefs = { expose_whatsapp: false, expose_email: false, in_app_only: false }
    expect((await claim('7K3PQ')).whatsapp_url).toBeNull()
    row.contact_prefs = { expose_whatsapp: true, expose_email: false, in_app_only: false }
    row.phone_has_whatsapp = false
    expect((await claim('7K3PQ')).whatsapp_url).toBeNull()
  })

  it('a repeat refreshes the open claim: same id, the new phone, one row', async () => {
    const pedro = await asNewcomer('pedro.ruiz@correo.co')
    const first = await claim('7K3PQ')
    const again = (await call(
      api.claimRecovery,
      { params: { code: '7K3PQ' }, body: { phone: '+573009998877' } },
      asIs,
    )) as { id: string }
    expect(again.id).toBe(first.id)
    const mine = db.recoveryClaims.filter(
      (c) => c.case_code === '7K3PQ' && c.claimant_id === pedro.id,
    )
    expect(mine).toHaveLength(1)
    expect(mine[0]?.phone).toBe('+573009998877')
    expect(mine[0]?.status).toBe('open')
  })

  it('a repeat without photos keeps the earlier ones; one with photos replaces them', async () => {
    const pedro = await asNewcomer('pedro.ruiz@correo.co')
    const send = (photo_urls: string[]) =>
      call(
        api.claimRecovery,
        { params: { code: '7K3PQ' }, body: { phone: '+573001112233', photo_urls } },
        asIs,
      )
    const photo = (n: number) => `https://cdn.media.test/claims/${n}.jpg`
    await send([photo(1)])
    const row = () => db.recoveryClaims.find((c) => c.claimant_id === pedro.id)
    await send([])
    expect(row()?.photo_urls).toEqual([photo(1)])
    await send([photo(2)])
    expect(row()?.photo_urls).toEqual([photo(2)])
  })

  it('an ineligible from_sighting_id is ignored and the claim is still created', async () => {
    const pedro = await asNewcomer('pedro.ruiz@correo.co')
    const made = await call(
      api.claimRecovery,
      { params: { code: '7K3PQ' }, body: { phone: '+573001112233', from_sighting_id: 'not-mine' } },
      asIs,
    )
    expect((made as { id: string }).id).toBeTruthy()
    const row = db.recoveryClaims.find((c) => c.claimant_id === pedro.id)
    expect(row?.from_sighting_id).toBeNull()
  })

  it('a claim on an expired case whose pet has another active case is `active_case_exists`', async () => {
    await asNewcomer('pedro.ruiz@correo.co')
    const luna = db.cases['7K3PQ']
    if (luna?.vertical !== 'lost') throw new Error('expected lost')
    const other = Object.values(db.cases).find(
      (c) => c.vertical === 'lost' && c.code !== luna.code && c.status === 'active',
    )
    if (!other) throw new Error('need a second lost case')
    Object.assign(luna, {
      status: 'expired',
      resolved_at: new Date().toISOString(),
      pet_id: other.pet_id,
    })
    expect((await failure(claim('7K3PQ'))).code).toBe('active_case_exists')
  })

  it('a repeat refreshes a stale claim back to open', async () => {
    const pedro = await asNewcomer('pedro.ruiz@correo.co')
    await claim('7K3PQ')
    const row = () => db.recoveryClaims.find((c) => c.claimant_id === pedro.id)
    later(8 * DAY)
    await claim('7K3PQ')
    expect(row()?.status).toBe('open')
    expect(Date.parse(row()?.stale_at ?? '')).toBeGreaterThan(Date.now())
  })

  it('the badge is null in the feed for everyone but the publisher', async () => {
    const anonymous = await call(api.getFeed, { query: {} }, parseFeed)
    expect(anonymous.items.every((i) => i.possibleFind === null)).toBe(true)
    await asCarolina()
    const mine = await call(api.getFeed, { query: {} }, parseFeed)
    expect(mine.items.find((i) => i.code === '7K3PQ')?.possibleFind).toBe(true)
  })
})

describe('parity with the backend (lost L1: decisions #71–#84)', () => {
  type Wire = {
    status: string
    open_claim_count: number | null
    claims: { id: string; created_at: string; status: string }[]
    sightings: { id: string; mine: boolean; editable_until: string | null }[]
  }
  const wire = (code: string) => call(api.getCase, { params: { code } }, asIs) as Promise<Wire>
  const claim = (code: string, phone = '+573001112233') =>
    call(api.claimRecovery, { params: { code }, body: { phone } }, asIs) as Promise<{
      id: string
      whatsapp_url: string | null
    }>
  const answer = (code: string, claimId: string, status: 'confirmed' | 'dismissed') =>
    call(api.answerRecoveryClaim, { params: { code, claimId }, body: { status } }, asIs)
  const reunite = (code: string) =>
    call(api.reuniteCase, { params: { code }, body: { resolution_attribution: 'unknown' } }, asIs)
  const lost = (code: string): LostRow => {
    const row = db.cases[code]
    if (row?.vertical !== 'lost') throw new Error(`${code} is not lost`)
    return row
  }
  const pin = (fields: Record<string, unknown> = {}) =>
    call(
      api.reportSighting,
      {
        params: { code: '7K3PQ' },
        body: {
          point: { lat: 6.2455, lng: -75.5905 },
          seen_at: new Date().toISOString(),
          note: null,
          contact_phone: null,
          ...fields,
        },
      },
      (raw) => (raw as { id: string }).id,
    )
  const myPets = () =>
    call(api.listMyPets, {}, asIs) as Promise<
      {
        id: string
        name: string
        active_case_code: string | null
        reopenable_case_code: string | null
      }[]
    >
  /** A newer case of the same pet as `code`, with the given status. */
  function newerCaseOf(code: string, status: LostRow['status'], newCode = 'NEWER') {
    const base = lost(code)
    db.cases[newCode] = {
      ...base,
      code: newCode,
      status,
      published_at: new Date(Date.now() + HOUR).toISOString(),
      resolved_at: status === 'active' ? null : new Date().toISOString(),
    }
  }
  function expire(code: string, daysAgo = 1) {
    Object.assign(lost(code), {
      status: 'expired',
      resolved_at: new Date(Date.now() - daysAgo * DAY).toISOString(),
    })
  }

  describe('the owner’s answer to a claim (#77)', () => {
    it('flips between confirmed and dismissed, and a repeat changes nothing', async () => {
      await asCarolina()
      await answer('7K3PQ', 'claim-luna', 'confirmed')
      expect(db.recoveryClaims[0]?.status).toBe('confirmed')
      const notifications = db.notifications.length
      await answer('7K3PQ', 'claim-luna', 'confirmed')
      expect(db.notifications).toHaveLength(notifications)
      await answer('7K3PQ', 'claim-luna', 'dismissed')
      expect(db.recoveryClaims[0]?.status).toBe('dismissed')
      await answer('7K3PQ', 'claim-luna', 'dismissed')
      await answer('7K3PQ', 'claim-luna', 'confirmed')
      expect(db.recoveryClaims[0]?.status).toBe('confirmed')
      // Confirming never closes the case.
      expect((await wire('7K3PQ')).status).toBe('active')
    })

    it('answers a stale claim either way, and on a case that is no longer active', async () => {
      await asCarolina()
      db.recoveryClaims[0]!.status = 'stale'
      await answer('7K3PQ', 'claim-luna', 'dismissed')
      await reunite('7K3PQ')
      await answer('7K3PQ', 'claim-luna', 'confirmed')
      expect(db.recoveryClaims[0]?.status).toBe('confirmed')
    })

    it('a claim that is not on this case is not found', async () => {
      await asCarolina()
      expect((await failure(answer('7K3PQ', 'claim-nope', 'confirmed'))).code).toBe('not_found')
    })
  })

  describe('“mine” for a pin (#73)', () => {
    it('an anonymous pin stays the browser’s after signing in', async () => {
      const id = await pin()
      await asNewcomer('pedro.ruiz@correo.co')
      const own = (await wire('7K3PQ')).sightings.find((s) => s.id === id)
      expect(own?.mine).toBe(true)
      expect(own?.editable_until).not.toBeNull()
    })

    it('a pin that has a person is only that person’s, not the browser’s', async () => {
      const pedro = await asNewcomer('pedro.ruiz@correo.co')
      const id = await pin()
      expect((await wire('7K3PQ')).sightings.find((s) => s.id === id)?.mine).toBe(true)
      signOut()
      expect((await wire('7K3PQ')).sightings.find((s) => s.id === id)?.mine).toBe(false)
      await asNewcomer('ana.gomez@correo.co')
      expect((await wire('7K3PQ')).sightings.find((s) => s.id === id)?.mine).toBe(false)
      expect(db.sightings.find((s) => s.id === id)?.reporter_id).toBe(pedro.id)
    })

    it('the claim link uses the same rule', async () => {
      await asNewcomer('ana.gomez@correo.co')
      const someone = await pin()
      db.sightings.find((s) => s.id === someone)!.reporter_id = 'user-andres'
      const made = (await call(
        api.claimRecovery,
        { params: { code: '7K3PQ' }, body: { phone: '+573001112233', from_sighting_id: someone } },
        asIs,
      )) as { id: string }
      expect(db.recoveryClaims.find((c) => c.id === made.id)?.from_sighting_id).toBeNull()
    })
  })

  describe('deleting a pin is a status change (#73)', () => {
    const del = (id: string) =>
      call(api.deleteSighting, { params: { code: '7K3PQ', sightingId: id } }, asIs)

    it('the pin is gone for everyone, the owner included; the row stays', async () => {
      const id = await pin()
      await del(id)
      expect(db.sightings.find((s) => s.id === id)?.status).toBe('deleted_by_reporter')
      expect((await wire('7K3PQ')).sightings.some((s) => s.id === id)).toBe(false)
      await asCarolina()
      expect((await wire('7K3PQ')).sightings.some((s) => s.id === id)).toBe(false)
    })

    it('deleting again answers the same success; others still cannot find it', async () => {
      const id = await pin()
      await del(id)
      await del(id)
      db.sightings.find((s) => s.id === id)!.reporter_key = 'device-someone-else'
      expect((await failure(del(id))).code).toBe('not_found')
    })

    it('a deleted pin can be neither corrected nor moderated; its client_id replays to its id', async () => {
      const client_id = 'a3c0f3de-5f3b-4b0b-8f0e-111111111111'
      const id = await pin({ client_id })
      await del(id)
      expect(await pin({ client_id })).toBe(id)
      expect(
        (
          await failure(
            call(
              api.correctSighting,
              {
                params: { code: '7K3PQ', sightingId: id },
                body: {
                  point: { lat: 6.2455, lng: -75.5905 },
                  seen_at: new Date().toISOString(),
                  note: null,
                },
              },
              asIs,
            ),
          )
        ).code,
      ).toBe('not_found')
      await asCarolina()
      expect(
        (
          await failure(
            call(
              api.moderateSighting,
              { params: { code: '7K3PQ', sightingId: id }, body: { hidden: true } },
              asIs,
            ),
          )
        ).code,
      ).toBe('not_found')
    })

    it('a closed case still lets the reporter delete', async () => {
      const id = await pin()
      await asCarolina()
      await reunite('7K3PQ')
      signOut()
      await del(id)
      expect(db.sightings.find((s) => s.id === id)?.status).toBe('deleted_by_reporter')
    })
  })

  describe('«Mis mascotas» (#78, #81)', () => {
    it('lists a pet with no name as an empty name', async () => {
      await asCarolina()
      db.pets.push({
        id: 'pet-sinnombre',
        name: null,
        owner_id: DEMO_OWNER_ID_FOR_TESTS,
        custody_state: 'claimed',
        health_flags: [],
        species: 'cat',
        size: 'small',
        colors: ['white'],
        marks: null,
        chip_number: null,
        photo_urls: [],
      })
      const pets = await myPets()
      expect(pets.find((p) => p.id === 'pet-sinnombre')?.name).toBe('')
    })

    it('counts only the caller’s own cases of a pet', async () => {
      await asCarolina()
      lost('7K3PQ').created_by = 'user-julian'
      const luna = (await myPets()).find((p) => p.id === 'pet-luna')
      expect(luna?.active_case_code).toBeNull()
    })

    it('offers only the pet’s newest case to reopen, and nothing while one is active', async () => {
      await asCarolina()
      expire('7K3PQ', 1)
      expect((await myPets()).find((p) => p.id === 'pet-luna')?.reopenable_case_code).toBe('7K3PQ')
      newerCaseOf('7K3PQ', 'reunited')
      expect((await myPets()).find((p) => p.id === 'pet-luna')?.reopenable_case_code).toBeNull()
      lost('NEWER').status = 'active'
      lost('NEWER').resolved_at = null
      const luna = (await myPets()).find((p) => p.id === 'pet-luna')
      expect(luna).toMatchObject({ active_case_code: 'NEWER', reopenable_case_code: null })
    })

    it('puts the most recently active pet first', async () => {
      await asCarolina()
      const before = (await myPets()).map((p) => p.id)
      const second = before[1]
      if (!second) throw new Error('needs two pets')
      const row = Object.values(db.cases).find(
        (c): c is LostRow =>
          c.vertical === 'lost' && c.pet_id === second && c.created_by === 'user-carolina',
      )
      if (!row) throw new Error('needs a case')
      row.published_at = new Date(Date.now() + DAY).toISOString()
      expect((await myPets())[0]?.id).toBe(second)
    })
  })

  describe('no links in the bio or the name (#79, #80)', () => {
    const update = (body: Record<string, unknown>) => call(api.updateProfile, { body }, asIs)
    const refused = [
      'https://marca.co',
      'mira www.marca.co',
      'escríbeme a wa.me/573001112233',
      'mailto:a@b.co',
      'tel:+573001112233',
      'tel:3001112233',
      'mi sitio es luna.com',
      'visita hola.shop ya',
      'HTTP://X',
    ]
    const accepted = [
      'Av.Poblado',
      'EE.UU.',
      'caminar.Vivo',
      'Medellín.Me encanta',
      'Tel: 300 123',
      'p.ej. así',
    ]

    it.each(refused)('refuses «%s» in the bio and in the name', async (text) => {
      await asCarolina()
      const bio = await failure(update({ bio: text }))
      expect(bio.code).toBe('validation_failed')
      expect(Object.keys(bio.fields ?? {})).toEqual(['bio'])
      const name = await failure(update({ display_name: text }))
      expect(Object.keys(name.fields ?? {})).toEqual(['display_name'])
    })

    it.each(accepted)('accepts «%s» in the bio and in the name', async (text) => {
      await asCarolina()
      await update({ bio: text })
      await update({ display_name: text })
    })

    it('a name of spaces is refused, and a name is stored trimmed', async () => {
      await asCarolina()
      expect((await failure(update({ display_name: '   ' }))).code).toBe('validation_failed')
      await update({ display_name: '  Carolina  ' })
      expect(db.persons.find((p) => p.id === 'user-carolina')?.display_name).toBe('Carolina')
    })

    it('stores nothing when one field is refused', async () => {
      await asCarolina()
      const before = db.persons.find((p) => p.id === 'user-carolina')?.city
      await failure(update({ city: 'Cali', bio: 'wa.me/57' }))
      expect(db.persons.find((p) => p.id === 'user-carolina')?.city).toBe(before)
    })
  })

  describe('only the pet’s newest case comes back (#81)', () => {
    it('the owner cannot reopen an older case once a newer one exists', async () => {
      await asCarolina()
      expire('7K3PQ', 1)
      newerCaseOf('7K3PQ', 'cancelled')
      const reopen = () => call(api.reopenCase, { params: { code: '7K3PQ' } }, asIs)
      expect((await failure(reopen())).code).toBe('invalid_transition')
      delete db.cases.NEWER
      await reopen()
      expect(lost('7K3PQ').status).toBe('active')
    })

    it('a newer active case is still `active_case_exists`, named first', async () => {
      await asCarolina()
      expire('7K3PQ', 1)
      newerCaseOf('7K3PQ', 'active')
      const error = await failure(call(api.reopenCase, { params: { code: '7K3PQ' } }, asIs))
      expect(error).toMatchObject({ code: 'active_case_exists' })
    })

    it('a claim on an older link does not reactivate it, whatever the newer case’s status', async () => {
      await asNewcomer('pedro.ruiz@correo.co')
      expire('7K3PQ', 1)
      for (const status of ['reunited', 'cancelled', 'expired'] as const) {
        newerCaseOf('7K3PQ', status)
        expect((await failure(claim('7K3PQ'))).code).toBe('invalid_transition')
        expect(lost('7K3PQ').status).toBe('expired')
        delete db.cases.NEWER
      }
      await claim('7K3PQ')
      expect(lost('7K3PQ').status).toBe('active')
    })

    it('on a tie of published_at the higher code is the newer', async () => {
      await asCarolina()
      expire('7K3PQ', 1)
      newerCaseOf('7K3PQ', 'reunited', 'ZZZZZ')
      lost('ZZZZZ').published_at = lost('7K3PQ').published_at
      expect((await failure(call(api.reopenCase, { params: { code: '7K3PQ' } }, asIs))).code).toBe(
        'invalid_transition',
      )
    })
  })

  describe('one claim per person per case (#82)', () => {
    it.each(['confirmed', 'dismissed'] as const)(
      'a repeat after the owner %s it returns the same claim, untouched',
      async (verdict) => {
        const pedro = await asNewcomer('pedro.ruiz@correo.co')
        const first = await claim('7K3PQ')
        const row = db.recoveryClaims.find((c) => c.id === first.id)!
        row.status = verdict
        const before = { ...row }
        const again = await claim('7K3PQ', '+573009998877')
        expect(again.id).toBe(first.id)
        expect(again.whatsapp_url).toBe(first.whatsapp_url)
        expect(row).toEqual(before)
        expect(db.recoveryClaims.filter((c) => c.claimant_id === pedro.id)).toHaveLength(1)
      },
    )

    it('an answered claim on an archived case does not revive it', async () => {
      await asNewcomer('pedro.ruiz@correo.co')
      const first = await claim('7K3PQ')
      db.recoveryClaims.find((c) => c.id === first.id)!.status = 'dismissed'
      expire('7K3PQ', 1)
      expect((await claim('7K3PQ')).id).toBe(first.id)
      expect(lost('7K3PQ').status).toBe('expired')
    })

    it('a reunited case still refuses the repeat', async () => {
      await asNewcomer('pedro.ruiz@correo.co')
      const first = await claim('7K3PQ')
      db.recoveryClaims.find((c) => c.id === first.id)!.status = 'confirmed'
      lost('7K3PQ').status = 'reunited'
      expect((await failure(claim('7K3PQ'))).code).toBe('invalid_transition')
    })
  })

  describe('an expired case can be reunited directly (#83)', () => {
    it('closes it without ever being active again; a cancelled one still refuses', async () => {
      await asCarolina()
      expire('7K3PQ', 3)
      await reunite('7K3PQ')
      expect(lost('7K3PQ')).toMatchObject({ status: 'reunited', resolution: 'reunited_home' })
      lost('7K3PQ').status = 'cancelled'
      expect((await failure(reunite('7K3PQ'))).code).toBe('invalid_transition')
    })
  })

  describe('the owner’s claims are ordered and dated by last activity (#84)', () => {
    it('a claim refreshed today comes first and shows today’s time', async () => {
      const pedro = await asNewcomer('pedro.ruiz@correo.co')
      const first = await claim('7K3PQ')
      later(9 * DAY)
      const mine = db.recoveryClaims.find((c) => c.id === first.id)!
      expect(mine.claimant_id).toBe(pedro.id)
      // The seeded claim is older than Pedro's; Pedro's repeat today makes his the latest.
      await claim('7K3PQ', '+573009998877')
      signOut()
      await asCarolina()
      const claims = (await wire('7K3PQ')).claims
      expect(claims[0]?.id).toBe(first.id)
      expect(claims[0]?.created_at).toBe(new Date().toISOString())
      expect(mine.created_at).not.toBe(claims[0]?.created_at)
    })

    it('shows the newest 50 and counts every open claim', async () => {
      await asCarolina()
      for (let n = 0; n < 60; n++) {
        db.recoveryClaims.push({
          id: `claim-${n}`,
          case_code: '7K3PQ',
          phone: '+573001112233',
          claimant_id: `p${n}`,
          created_at: new Date(Date.now() - n * HOUR).toISOString(),
          status: 'open',
          stale_at: new Date(Date.now() + DAY).toISOString(),
        })
      }
      const seen = await wire('7K3PQ')
      expect(seen.claims).toHaveLength(50)
      expect(seen.open_claim_count).toBe(61)
    })
  })

  describe('idempotent endings (#71)', () => {
    it('cancel twice and reopen on an active case answer the same success', async () => {
      await asCarolina()
      const cancel = () =>
        call(
          api.cancelCase,
          { params: { code: '7K3PQ' }, body: { resolution: 'false_alarm' } },
          asIs,
        )
      await cancel()
      await cancel()
      expect(lost('7K3PQ').status).toBe('cancelled')
      expect((await failure(call(api.reopenCase, { params: { code: '7K3PQ' } }, asIs))).code).toBe(
        'invalid_transition',
      )
      lost('7K3PQ').status = 'active'
      await call(api.reopenCase, { params: { code: '7K3PQ' } }, asIs)
      expect(lost('7K3PQ').status).toBe('active')
    })
  })

  describe('the body is checked after the lookups, in the backend’s order', () => {
    const badReunite = { resolution_attribution: 'nope' }
    const reuniteWith = (code: string, body: unknown) =>
      call(api.reuniteCase, { params: { code }, body: body as never }, asIs)

    it('not_found, then forbidden, then validation_failed, then invalid_transition', async () => {
      await asNewcomer('pedro.ruiz@correo.co')
      expect((await failure(reuniteWith('NOPE1', badReunite))).code).toBe('not_found')
      expect((await failure(reuniteWith('7K3PQ', badReunite))).code).toBe('forbidden')
      signOut()
      await asCarolina()
      expect((await failure(reuniteWith('7K3PQ', badReunite))).code).toBe('validation_failed')
      lost('7K3PQ').status = 'cancelled'
      expect((await failure(reuniteWith('7K3PQ', badReunite))).code).toBe('validation_failed')
      expect(
        (await failure(reuniteWith('7K3PQ', { resolution_attribution: 'unknown' }))).code,
      ).toBe('invalid_transition')
    })

    it('an edit of a closed case with a bad body is validation_failed first', async () => {
      await asCarolina()
      lost('7K3PQ').status = 'reunited'
      const edit = (body: unknown) =>
        call(api.editLost, { params: { code: '7K3PQ' }, body: body as never }, asIs)
      expect((await failure(edit({ last_seen_radius_m: -5 }))).code).toBe('validation_failed')
      expect((await failure(edit({ marks: 'collar' }))).code).toBe('invalid_transition')
    })

    it('a claim: the owner is forbidden before the phone is checked, the phone before the status', async () => {
      const badClaim = (code: string) =>
        call(api.claimRecovery, { params: { code }, body: { phone: 'abc' } as never }, asIs)
      await asCarolina()
      expect((await failure(badClaim('7K3PQ'))).code).toBe('forbidden')
      signOut()
      await asNewcomer('pedro.ruiz@correo.co')
      lost('7K3PQ').status = 'reunited'
      expect((await failure(badClaim('7K3PQ'))).code).toBe('validation_failed')
      expect((await failure(claim('7K3PQ'))).code).toBe('invalid_transition')
    })

    it('an answer: the claim is looked up before the status is checked', async () => {
      await asCarolina()
      const bad = (claimId: string) =>
        call(
          api.answerRecoveryClaim,
          { params: { code: '7K3PQ', claimId }, body: { status: 'maybe' } as never },
          asIs,
        )
      expect((await failure(bad('claim-nope'))).code).toBe('not_found')
      expect((await failure(bad('claim-luna'))).code).toBe('validation_failed')
    })

    it('moderation: the pin is looked up before the body', async () => {
      await asCarolina()
      const bad = (sightingId: string) =>
        call(
          api.moderateSighting,
          { params: { code: '7K3PQ', sightingId }, body: { hidden: 'si' } as never },
          asIs,
        )
      expect((await failure(bad('s-nope'))).code).toBe('not_found')
      expect((await failure(bad('s3'))).code).toBe('validation_failed')
    })

    it('a body that is not JSON is refused before any lookup', async () => {
      await asNewcomer('pedro.ruiz@correo.co')
      const response = await fetch(new URL('/cases/NOPE1/reunite', env.apiUrl), {
        method: 'POST',
        body: 'not json',
        headers: { 'content-type': 'application/json' },
      })
      expect(response.status).toBe(422)
    })
  })
})
