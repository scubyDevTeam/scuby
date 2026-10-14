// The emulated backend, driven through the real client: every request and answer below crosses the
// contract twice (route.ts checks both sides, http.ts parses), so a scenario that passes here is
// one the real backend must also pass. Rules: docs/product/04, 05, 08; conventions: docs/eng/api.md.
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, call } from '../api-client/http'
import { api } from '../contracts/api'
import { parseCase } from '../contracts/case'
import { parseFeed } from '../contracts/feed'
import { parseMyCases, parseNotifications, parsePets, parsePublish } from '../contracts/owner'
import { parseProfile, parseUser } from '../contracts/session'
import { db, type LostRow, resetDb } from './db'
import { DEMO_CODE, handlers } from './handlers'
import { routed } from './route'
import { DAY, HOUR } from './rules'
import { signOut } from './session'

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
    expect(luna.openClaimCount).toBe(1)
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
      'AD9PT',
      'HE7PA',
      'C4STD',
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

  it('is rate-limited: one per reporter per case every 15 minutes', async () => {
    await sighting()
    expect((await failure(sighting())).code).toBe('rate_limited')
    later(16 * 60_000)
    await sighting()
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

  it('a case closes once: reuniting it again is `invalid_transition`', async () => {
    await asCarolina()
    const reunite = () =>
      call(
        api.reuniteCase,
        { params: { code: '7K3PQ' }, body: { resolution_attribution: 'platform_claim' } },
        asIs,
      )
    await reunite()
    expect((await failure(reunite())).code).toBe('invalid_transition')
    expect((await caseOf('7K3PQ')).status).toBe('reunited')
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
    const claim = (await call(
      api.claimRecovery,
      { params: { code: '7K3PQ' }, body: { phone: '+573001112233' } },
      asIs,
    )) as { id: string; whatsapp_url: string | null }
    expect(claim.whatsapp_url).toBe('https://wa.me/573000000000')

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
    await call(api.claimRecovery, { params: { code }, body: { phone: '+573001112233' } }, asIs)
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
    expect((await call(api.listNotifications, {}, parseNotifications)).unreadCount).toBe(2)
    await call(api.readNotifications, { body: { ids: null } }, asIs)
    expect((await call(api.listNotifications, {}, parseNotifications)).unreadCount).toBe(0)
  })
})

describe('one request, one transaction', () => {
  it('a request refused part-way leaves no trace', async () => {
    await asCarolina()
    // A claim check-in whose claim was already dismissed: the check-in is marked answered first,
    // then confirming the claim is refused.
    db.recoveryClaims[0]!.status = 'dismissed'
    db.checkins.push({
      id: 'ck-due',
      case_code: '7K3PQ',
      claim_id: 'claim-luna',
      trigger: 'post_recovery_claim',
      scheduled_at: new Date(Date.now() - HOUR).toISOString(),
      responded_at: null,
      cancelled_at: null,
      response: null,
    })
    const error = await failure(
      call(
        api.answerCheckin,
        { params: { code: '7K3PQ', checkinId: 'ck-due' }, body: { response: 'claim_confirmed' } },
        asIs,
      ),
    )
    expect(error.code).toBe('invalid_transition')
    expect(db.checkins.find((c) => c.id === 'ck-due')?.responded_at).toBeNull()
    expect((await caseOf('7K3PQ')).status).toBe('active')
  })
})
