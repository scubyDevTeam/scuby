// The emulated backend, driven through the real client: every request and answer below crosses the
// contract twice (route.ts checks both sides, http.ts parses), so a scenario that passes here is
// one the real backend must also pass. Rules: docs/product/04, 05, 08; conventions: docs/eng/api.md.
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, call } from '../api-client/http'
import { parseInterest } from '../contracts/adoption'
import { api } from '../contracts/api'
import { parseCase } from '../contracts/case'
import { parseFeed } from '../contracts/feed'
import { parseMyCases, parseNotifications, parsePets, parsePublish } from '../contracts/owner'
import { parseProfile, parseUser } from '../contracts/session'
import { db, type LostRow, resetDb } from './db'
import { DEMO_OWNER_ID as DEMO_OWNER_ID_FOR_TESTS } from './fixtures'
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
  fee_cop: 0,
  fee_covers: [],
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
    expect(canela.fee).toEqual({ cop: 120_000, covers: ['sterilization', 'vaccines', 'deworming'] })
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
      ['B3TOS', 'En proceso · Cuota $120.000'],
      ['M1SHI', 'En proceso · Sin cuota'],
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

describe('adoption — publishing (06 · fee rule; 05 · the day-15 conversion)', () => {
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
    expect(feed.items[0]).toMatchObject({ code: published.code, detail: 'Sin cuota' })
    const mine = await call(api.listMyCases, {}, parseMyCases)
    expect(mine[0]).toMatchObject({ code: published.code, vertical: 'adoption' })
  })

  it('a fee must say what it covers', async () => {
    await asVerifiedCarolina()
    const body = { ...listing, fee_cop: 150_000, fee_covers: [] }
    expect((await failure(call(api.publishAdoption, { body }, asIs))).code).toBe(
      'validation_failed',
    )
  })

  it('a fee above the local norm is published and queued for moderation — never blocked', async () => {
    await asVerifiedCarolina()
    const body = { ...listing, fee_cop: 400_000, fee_covers: ['vaccines' as const] }
    const published = await call(api.publishAdoption, { body }, parsePublish)
    if (published.kind !== 'published') throw new Error('expected a published listing')
    expect(db.reports).toContainEqual(
      expect.objectContaining({ target_id: published.code, note: 'fee_above_norm' }),
    )
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
