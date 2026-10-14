import { delay, HttpResponse, http } from 'msw'
import type { z } from 'zod/mini'
import type { feedWire } from '../contracts/feed'
import { env } from '../env'
import { DEMO_OWNER_ID, db, foundCase, lostCase, newCode, newId } from './db'
import { feedItems, purgedCodes } from './fixtures'
import { currentUser, saveUser, unauthorized } from './session'

type FeedItemWire = z.input<typeof feedWire>['items'][number]

const api = (path: string) => new URL(path, env.apiUrl).toString()

/** The code the emulated backend accepts, by email and by SMS. The app shows it while mocks are on. */
export const DEMO_CODE = '123456'

const signIn = (id: string, email: string, displayName: string) => {
  const user = { id, display_name: displayName, email, phone: null }
  saveUser(user)
  return HttpResponse.json(user)
}

/** «juan.perez@correo.co» → «Juan Perez», until the profile lets people name themselves. */
const nameFrom = (email: string) =>
  (email.split('@')[0] ?? '')
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(' ')

const isOwner = (code: string) => {
  const user = currentUser()
  return Boolean(user && db.owners[code] === user.id)
}

/** The owner's own case, or the response that says why not. */
function ownedCase(code: unknown) {
  const found = lostCase(code)
  if (!found) return { error: new HttpResponse(null, { status: 404 }) }
  if (!isOwner(found.code)) return { error: new HttpResponse(null, { status: 403 }) }
  return { found }
}

type SightingBody = { point: { lat: number; lng: number }; seen_at: string; note: string | null }

type PublishBody = {
  pet_id: string | null
  pet: {
    name: string
    species: 'dog' | 'cat' | 'other'
    size: 'small' | 'medium' | 'large'
    colors: string[]
    marks: string | null
    photo_urls: string[]
  }
  last_seen_point: { lat: number; lng: number }
  last_seen_radius_m: number
  last_seen_at: string
  phone: string | null
  contact_prefs: { expose_whatsapp: boolean }
  otp_code: string | null
}

const auth = [
  http.get(api('/session'), () => {
    const user = currentUser()
    return user ? HttpResponse.json(user) : unauthorized()
  }),

  http.post(api('/auth/email/start'), async () => {
    await delay(250)
    return new HttpResponse(null, { status: 204 })
  }),

  http.post(api('/auth/email/verify'), async ({ request }) => {
    await delay(250)
    const { email, code } = (await request.json()) as { email: string; code: string }
    if (code !== DEMO_CODE) return new HttpResponse(null, { status: 422 })
    return signIn(`user-${email}`, email, nameFrom(email))
  }),

  http.post(api('/auth/google'), async () => {
    await delay(250)
    return signIn(DEMO_OWNER_ID, 'carolina@correo.co', 'Carolina Mejía')
  }),

  http.post(api('/auth/sign-out'), () => {
    saveUser(null)
    return new HttpResponse(null, { status: 204 })
  }),
]

const publicReads = [
  http.get(api('/config'), () =>
    HttpResponse.json({
      supported_countries: [
        {
          code: 'CO',
          phone_prefix: '+57',
          mobile_pattern: '^3\\d{9}$',
          default_center: { lat: 6.2442, lng: -75.5812 },
        },
      ],
    }),
  ),

  http.get(api('/cases/:code'), async ({ params }) => {
    await delay(250)
    const code = String(params.code).toUpperCase()
    if (purgedCodes.has(code)) return new HttpResponse(null, { status: 410 })
    const found = db.cases[code]
    if (!found) return new HttpResponse(null, { status: 404 })
    if (found.vertical === 'found') {
      // The withheld detail and the claims go to the custodian and to nobody else.
      const custodian = isOwner(code)
      return HttpResponse.json({
        ...found,
        viewer: custodian ? 'custodian' : 'public',
        withheld_detail: custodian ? found.withheld_detail : null,
        ownership_claims: custodian ? found.ownership_claims : [],
      })
    }
    if (found.vertical !== 'lost') return HttpResponse.json(found)
    // Who is asking decides what they get: claims and their phones are the owner's alone.
    const owner = isOwner(code)
    return HttpResponse.json({
      ...found,
      viewer: owner ? 'owner' : 'public',
      claims: owner ? found.claims : [],
    })
  }),

  http.get(api('/feed'), async ({ request }) => {
    await delay(250)
    const query = new URL(request.url).searchParams
    const vertical = query.get('vertical')
    const species = query.get('species')
    const published = db.published.flatMap((code): FeedItemWire[] => {
      const lost = lostCase(code)
      const found = foundCase(code)
      if (lost?.status === 'active') {
        return [
          {
            code,
            vertical: 'lost' as const,
            title: lost.pet.name,
            species: lost.pet.species,
            summary: null,
            place_name: lost.last_seen.place_name,
            point: lost.last_seen.center,
            photo_url: lost.pet.photo_urls[0] ?? null,
            happened_at: lost.last_seen.at,
            possible_find: lost.open_claim_count > 0,
            sightings_count: lost.sightings.length,
            last_sighting_at: null,
            detail: null,
          },
        ]
      }
      if (found?.status === 'active') {
        return [
          {
            code,
            vertical: 'found' as const,
            title: foundTitle(found.pet),
            species: found.pet.species,
            summary: null,
            place_name: found.found.place_name,
            point: found.found.center,
            photo_url: found.pet.photo_urls[0] ?? null,
            happened_at: found.found.at,
            possible_find: false,
            sightings_count: null,
            last_sighting_at: null,
            detail: null,
          },
        ]
      }
      return []
    })
    const items = [...published, ...feedItems()].filter(
      (item) => (!vertical || item.vertical === vertical) && (!species || item.species === species),
    )
    return HttpResponse.json({ scope: 'local', items })
  }),
]

const helperActions = [
  http.post(api('/cases/:code/sightings'), async ({ params, request }) => {
    await delay(250)
    const found = lostCase(params.code)
    if (!found) return new HttpResponse(null, { status: 404 })
    const body = (await request.json()) as SightingBody
    const id = newId('s-new-')
    found.sightings.push({
      id,
      point: body.point,
      seen_at: body.seen_at,
      note: body.note,
      photo_url: null,
      source: 'anonymous',
      highlighted_by_owner: false,
    })
    return HttpResponse.json({ id }, { status: 201 })
  }),

  http.post(api('/cases/:code/recovery-claims'), async ({ params, request }) => {
    await delay(250)
    const found = lostCase(params.code)
    if (!found) return new HttpResponse(null, { status: 404 })
    const { phone } = (await request.json()) as { phone: string }
    // The row exists before the channel opens: the badge appears whatever happens in WhatsApp.
    const id = newId('claim-')
    found.claims = [
      ...(found.claims ?? []),
      { id, phone, created_at: new Date().toISOString(), status: 'open' },
    ]
    found.open_claim_count += 1
    return HttpResponse.json(
      { id, whatsapp_url: found.contact?.whatsapp_url ?? null },
      { status: 201 },
    )
  }),

  http.post(api('/reports'), async () => {
    await delay(250)
    return HttpResponse.json({ id: newId('report-') }, { status: 201 })
  }),
]

const ownerActions = [
  http.get(api('/me/pets'), () => {
    const user = currentUser()
    if (!user) return unauthorized()
    return HttpResponse.json(
      db.pets
        .filter((pet) => pet.owner_id === user.id)
        .map(({ owner_id: _, ...pet }) => ({
          ...pet,
          active_case_code:
            Object.entries(db.casePets).find(
              ([code, petId]) => petId === pet.id && lostCase(code)?.status === 'active',
            )?.[0] ?? null,
        })),
    )
  }),

  http.get(api('/me/cases'), () => {
    const user = currentUser()
    if (!user) return unauthorized()
    const mine = Object.entries(db.owners)
      .filter(([, owner]) => owner === user.id)
      .flatMap(([code]) => {
        const lost = lostCase(code)
        if (lost) {
          return [
            {
              code,
              vertical: 'lost',
              status: lost.status,
              title: lost.pet.name,
              place_name: lost.last_seen.place_name,
              photo_url: lost.pet.photo_urls[0] ?? null,
              published_at: lost.last_seen.at,
              open_claim_count: lost.open_claim_count,
            },
          ]
        }
        const found = foundCase(code)
        if (!found) return []
        return [
          {
            code,
            vertical: 'found',
            status: found.status,
            title: foundTitle(found.pet),
            place_name: found.found.place_name,
            photo_url: found.pet.photo_urls[0] ?? null,
            published_at: found.found.at,
            open_claim_count: found.open_claim_count,
          },
        ]
      })
    return HttpResponse.json(mine)
  }),

  http.post(api('/uploads'), async ({ request }) => {
    await delay(200)
    const file = (await request.formData()).get('file')
    if (!(file instanceof Blob)) return new HttpResponse(null, { status: 422 })
    const bytes = new Uint8Array(await file.arrayBuffer())
    let binary = ''
    for (const byte of bytes) binary += String.fromCharCode(byte)
    return HttpResponse.json({ url: `data:${file.type};base64,${btoa(binary)}` }, { status: 201 })
  }),

  http.post(api('/lost-cases'), async ({ request }) => {
    await delay(300)
    const user = currentUser()
    if (!user) return unauthorized()
    const body = (await request.json()) as PublishBody

    // One active case per animal: two would mean two broadcasts and two check-in streams.
    if (body.pet_id) {
      const active = Object.entries(db.casePets).find(
        ([code, petId]) => petId === body.pet_id && lostCase(code)?.status === 'active',
      )
      if (active) return HttpResponse.json({ code: active[0] }, { status: 409 })
    }

    // Verification belongs to the number: a new one is confirmed by SMS before the case goes live.
    if (body.phone && body.phone !== user.phone) {
      if (!body.otp_code) return HttpResponse.json({ phone_step: 'otp' })
      if (body.otp_code !== DEMO_CODE) return new HttpResponse(null, { status: 422 })
      saveUser({ ...user, phone: body.phone })
    }
    const phone = body.phone ?? user.phone
    if (!phone) return new HttpResponse(null, { status: 422 })

    const petId = body.pet_id ?? newId('pet-')
    if (!body.pet_id) db.pets.push({ id: petId, owner_id: user.id, ...body.pet })
    const code = newCode()
    db.cases[code] = {
      code,
      vertical: 'lost',
      status: 'active',
      resolved_at: null,
      viewer: 'owner',
      pet: body.pet,
      last_seen: {
        center: body.last_seen_point,
        radius_m: body.last_seen_radius_m,
        at: body.last_seen_at,
        // Naming the neighbourhood is the backend's job (geocoding); the emulation has one answer.
        place_name: 'Laureles',
      },
      open_claim_count: 0,
      sightings: [],
      claims: [],
      contact: {
        display_name: user.display_name,
        whatsapp_url: body.contact_prefs.expose_whatsapp
          ? `https://wa.me/${phone.replace('+', '')}`
          : null,
      },
    }
    db.owners[code] = user.id
    db.casePets[code] = petId
    db.published.unshift(code)
    return HttpResponse.json({ code }, { status: 201 })
  }),

  http.post(api('/cases/:code/reunite'), async ({ params }) => {
    await delay(250)
    const { found, error } = ownedCase(params.code)
    if (!found) return error
    if (found.status !== 'active') return new HttpResponse(null, { status: 409 })
    found.status = 'reunited'
    found.resolved_at = new Date().toISOString()
    found.open_claim_count = 0
    return HttpResponse.json({ id: found.code })
  }),

  http.post(api('/cases/:code/cancel'), async ({ params }) => {
    await delay(250)
    const { found, error } = ownedCase(params.code)
    if (!found) return error
    if (found.status !== 'active') return new HttpResponse(null, { status: 409 })
    found.status = 'cancelled'
    found.resolved_at = new Date().toISOString()
    return HttpResponse.json({ id: found.code })
  }),

  http.post(api('/cases/:code/reopen'), async ({ params }) => {
    await delay(250)
    const code = String(params.code).toUpperCase()
    const found = lostCase(code) ?? foundCase(code)
    if (!found) return new HttpResponse(null, { status: 404 })
    if (!isOwner(code)) return new HttpResponse(null, { status: 403 })
    if (found.status !== 'expired') return new HttpResponse(null, { status: 409 })
    found.status = 'active'
    found.resolved_at = null
    return HttpResponse.json({ id: code })
  }),

  http.post(api('/cases/:code/claims/:claimId'), async ({ params, request }) => {
    await delay(250)
    const { found, error } = ownedCase(params.code)
    if (!found) return error
    const claim = found.claims?.find((c) => c.id === params.claimId)
    if (!claim) return new HttpResponse(null, { status: 404 })
    const { status } = (await request.json()) as { status: 'confirmed' | 'dismissed' }
    claim.status = status
    found.open_claim_count = (found.claims ?? []).filter((c) => c.status === 'open').length
    return HttpResponse.json({ id: claim.id })
  }),
]

const SPECIES = { dog: 'Perro', cat: 'Gato', other: 'Animal' } as const
const SIZE = { small: 'pequeño', medium: 'mediano', large: 'grande' } as const

/** «Gato negro, pequeño» — a found animal has no name, so its card is titled by what it looks like. */
function foundTitle(pet: {
  species: keyof typeof SPECIES
  size: keyof typeof SIZE | null
  colors: string[]
}) {
  const colour = pet.colors[0]?.toLowerCase()
  return [[SPECIES[pet.species], colour].filter(Boolean).join(' '), pet.size && SIZE[pet.size]]
    .filter(Boolean)
    .join(', ')
}

/** The custodian's own found case, or the response that says why not. */
function heldCase(code: unknown) {
  const found = foundCase(code)
  if (!found) return { error: new HttpResponse(null, { status: 404 }) }
  if (!isOwner(found.code)) return { error: new HttpResponse(null, { status: 403 }) }
  return { found }
}

const metres = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) =>
  Math.hypot(
    (a.lat - b.lat) * 110_574,
    (a.lng - b.lng) * 111_320 * Math.cos((a.lat * Math.PI) / 180),
  )

type FoundPublishBody = {
  pet: {
    species: 'dog' | 'cat' | 'other'
    size: 'small' | 'medium' | 'large'
    colors: string[]
    marks: string | null
    photo_urls: string[]
  }
  found_point: { lat: number; lng: number }
  found_radius_m: number
  found_at: string
  holding_where: 'home' | 'vet' | 'street_temporary'
  withheld_detail: string | null
  phone: string | null
  contact_prefs: { expose_whatsapp: boolean }
  otp_code: string | null
}

const foundActions = [
  // A stand-in for the matching algorithm (O7): same species, within 5 km, still being searched for.
  http.post(api('/matches'), async ({ request }) => {
    await delay(300)
    const body = (await request.json()) as { species: string; point: { lat: number; lng: number } }
    const candidates = Object.values(db.cases).flatMap((item) => {
      if (item.vertical !== 'lost' || item.status !== 'active') return []
      if (item.pet.species !== body.species) return []
      const distance = metres(item.last_seen.center, body.point)
      if (distance > 5000) return []
      return [
        {
          code: item.code,
          name: item.pet.name,
          photo_url: item.pet.photo_urls[0] ?? null,
          why: ['Misma especie', `A ${Math.round(distance / 100) * 100} m de donde se perdió`],
        },
      ]
    })
    return HttpResponse.json({ candidates })
  }),

  http.post(api('/sightings'), async () => {
    await delay(250)
    return HttpResponse.json({ id: newId('orphan-') }, { status: 201 })
  }),

  http.post(api('/found-cases'), async ({ request }) => {
    await delay(300)
    const user = currentUser()
    if (!user) return unauthorized()
    const body = (await request.json()) as FoundPublishBody
    if (body.phone && body.phone !== user.phone) {
      if (!body.otp_code) return HttpResponse.json({ phone_step: 'otp' })
      if (body.otp_code !== DEMO_CODE) return new HttpResponse(null, { status: 422 })
      saveUser({ ...user, phone: body.phone })
    }
    const phone = body.phone ?? user.phone
    if (!phone) return new HttpResponse(null, { status: 422 })
    const code = newCode()
    db.cases[code] = {
      code,
      vertical: 'found',
      status: 'active',
      resolved_at: null,
      viewer: 'custodian',
      pet: body.pet,
      found: {
        center: body.found_point,
        radius_m: body.found_radius_m,
        at: body.found_at,
        place_name: 'Laureles',
      },
      holding_where: body.holding_where,
      held_since: body.found_at,
      hold_offer_at: new Date(new Date(body.found_at).getTime() + 15 * 86_400_000).toISOString(),
      open_claim_count: 0,
      withheld_detail: body.withheld_detail,
      ownership_claims: [],
      contact: {
        display_name: user.display_name,
        whatsapp_url: body.contact_prefs.expose_whatsapp
          ? `https://wa.me/${phone.replace('+', '')}`
          : null,
      },
    }
    db.owners[code] = user.id
    db.published.unshift(code)
    return HttpResponse.json({ code }, { status: 201 })
  }),

  // «Es mío» is never anonymous: it asks to take an animal (docs/product/05).
  http.post(api('/cases/:code/ownership-claims'), async ({ params, request }) => {
    await delay(250)
    const user = currentUser()
    if (!user) return unauthorized()
    const found = foundCase(params.code)
    if (!found) return new HttpResponse(null, { status: 404 })
    const body = (await request.json()) as {
      evidence_notes: string | null
      chip_number: string | null
    }
    const id = newId('own-')
    found.ownership_claims = [
      ...(found.ownership_claims ?? []),
      {
        id,
        claimant_name: user.display_name,
        created_at: new Date().toISOString(),
        status: 'open',
        evidence_notes: body.evidence_notes,
        chip_number: body.chip_number,
        photo_count: 0,
        from_lost_case_code: null,
        whatsapp_url: user.phone ? `https://wa.me/${user.phone.replace('+', '')}` : null,
      },
    ]
    found.open_claim_count += 1
    // The row exists before any channel opens.
    return HttpResponse.json(
      { id, whatsapp_url: found.contact?.whatsapp_url ?? null },
      { status: 201 },
    )
  }),

  http.post(api('/cases/:code/ownership-claims/:claimId'), async ({ params, request }) => {
    await delay(250)
    const { found, error } = heldCase(params.code)
    if (!found) return error
    const claim = found.ownership_claims?.find((c) => c.id === params.claimId)
    if (!claim) return new HttpResponse(null, { status: 404 })
    const { status } = (await request.json()) as { status: 'confirmed' | 'dismissed' }
    claim.status = status
    found.open_claim_count = (found.ownership_claims ?? []).filter(
      (c) => c.status === 'open',
    ).length
    return HttpResponse.json({ id: claim.id })
  }),

  http.post(api('/cases/:code/resolve'), async ({ params, request }) => {
    await delay(250)
    const { found, error } = heldCase(params.code)
    if (!found) return error
    if (found.status !== 'active') return new HttpResponse(null, { status: 409 })
    const { outcome } = (await request.json()) as {
      outcome: 'reunited' | 'kept' | 'transferred_to_org' | 'cancelled' | 'keep_searching'
    }
    if (outcome === 'keep_searching') {
      found.hold_offer_at = new Date(Date.now() + 15 * 86_400_000).toISOString()
      return HttpResponse.json({ id: found.code })
    }
    found.status = outcome
    found.resolved_at = new Date().toISOString()
    found.open_claim_count = 0
    return HttpResponse.json({ id: found.code })
  }),
]

export const handlers = [
  ...foundActions,
  ...auth,
  ...publicReads,
  ...helperActions,
  ...ownerActions,
]
