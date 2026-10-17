// The email's one-tap links (docs/eng/comms.md · Actionable check-ins, The scanner rule). Each
// button of a check-in email is `/r/<token>`, bound to one check-in and one answer, single-use and
// expiring; the token is the auth, so a link acts as the case's publisher without a session.
//
// The real backend mints a random token per button when the email goes out and stores it. The
// emulation derives it instead — a keyed hash of (checkin_id, response) — so a test can know one
// without reading an inbox (DEMO_LINKS), and the token's state is read off the check-in row it
// answers: answered with this link's answer = used, answered otherwise or closed = already answered.
import type * as z from 'zod/mini'
import { api } from '../../contracts/api'
import type { checkinLinkWire, LinkResponse } from '../../contracts/links'
import { type CaseRow, type CheckinRow, db, findCase, person } from '../db'
import { fail, route } from '../route'
import { DAY, iso, ms } from '../rules'
import { adopt } from './adoption'
import { closeRequest } from './help'
import { answerCheckinAs } from './owner'

type Answer = { response: LinkResponse; kind: 'safe' | 'consequential' }

const safe = (response: LinkResponse): Answer => ({ response, kind: 'safe' })
const consequential = (response: LinkResponse): Answer => ({ response, kind: 'consequential' })

/**
 * The buttons of each check-in's email. Safe answers keep the case as it is; every answer that
 * ends something — the case, a claim — is consequential and waits for the confirm page's POST.
 * «No es ella» changes the claim, so it waits too. Found cases have no check-ins yet.
 */
function answersOf(checkin: CheckinRow, row: CaseRow): Answer[] {
  if (row.vertical === 'lost') {
    return checkin.trigger === 'time_based'
      ? [safe('still_lost'), consequential('reunited'), consequential('delete')]
      : [
          consequential('claim_confirmed'),
          consequential('claim_dismissed'),
          safe('still_verifying'),
        ]
  }
  if (row.vertical === 'adoption') return [safe('still_available'), consequential('adopted')]
  if (row.vertical === 'help') return [safe('still_needed'), consequential('no_longer_needed')]
  return []
}

/** A link works for a week after its email goes out (push first, email 24 h later). */
const LINK_LIFETIME = 7 * DAY
const EMAIL_AFTER = DAY

const SECRET = 'mock-link-secret'

function fnv(text: string, seed: number): string {
  let hash = seed >>> 0
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 16777619) >>> 0
  }
  return hash.toString(36).padStart(7, '0')
}

/** The token behind one button of one check-in's email. */
export function linkToken(checkinId: string, response: LinkResponse): string {
  const text = `${SECRET}|${checkinId}|${response}`
  return fnv(text, 2166136261) + fnv(text, 0x9747b28c)
}

/**
 * Buttons of the seeded check-ins, for tests and the demo: `/r/<token>` with one of these.
 * Misha's «Sigue disponible» (safe, the demo account's listing) and Milo's «Ya apareció»
 * (consequential, Julián's lost dog; sign in with julian@correo.co to see his side).
 */
export const DEMO_LINKS = {
  mishaStillAvailable: linkToken('ck-misha-1', 'still_available'),
  miloStillLost: linkToken('ck-milo-1', 'still_lost'),
  miloReunited: linkToken('ck-milo-1', 'reunited'),
}

type Found = { checkin: CheckinRow; row: CaseRow; answer: Answer; answers: Answer[] }

/** A question not asked yet has no email, so its links do not exist. */
function resolve(token: string, at: number): Found {
  for (const checkin of db.checkins) {
    if (ms(checkin.scheduled_at) > at) continue
    const row = findCase(checkin.case_code)
    if (!row) continue
    const answers = answersOf(checkin, row)
    const answer = answers.find((a) => linkToken(checkin.id, a.response) === token)
    if (answer) return { checkin, row, answer, answers }
  }
  fail('not_found')
}

type State = 'open' | 'used' | 'already_answered' | 'expired'

function stateOf({ checkin, row, answer }: Found, at: number): State {
  if (checkin.responded_at)
    return checkin.response === answer.response ? 'used' : 'already_answered'
  if (checkin.cancelled_at || row.status !== 'active') return 'already_answered'
  if (ms(checkin.scheduled_at) + EMAIL_AFTER + LINK_LIFETIME < at) return 'expired'
  return 'open'
}

/** The same effect as the app's answer, as the case's publisher, with the app's defaults. */
function apply({ checkin, row, answer }: Found) {
  const publisher = person('created_by' in row ? row.created_by : null) ?? fail('not_found')
  const { response } = answer
  if (response === 'adopted' || response === 'no_longer_needed') {
    checkin.responded_at = iso(Date.now())
    checkin.response = response
    if (row.vertical === 'adoption') {
      // The person «En proceso», if there is one, is who adopted; otherwise it happened off the app.
      const chosen = db.adoptionInterests.find(
        (i) => i.case_code === row.code && i.status === 'chosen',
      )
      adopt(row, chosen ?? null)
    }
    if (row.vertical === 'help') closeRequest(row, 'need_ended')
    return
  }
  answerCheckinAs(
    publisher,
    { code: row.code, checkinId: checkin.id },
    { response, resolution_attribution: null, resolution: null },
  )
}

function view(found: Found, state: z.input<typeof checkinLinkWire>['state']) {
  const { checkin, row, answer, answers } = found
  const pet = db.pets.find((p) => p.id === row.pet_id)
  const decline = answers.find((a) => a.kind === 'safe')
  return {
    case_code: row.code,
    vertical: row.vertical,
    pet_name: pet?.name ?? null,
    photo_url: pet?.photo_urls[0] ?? null,
    response: answer.response,
    kind: answer.kind,
    state,
    decline_token: state === 'confirm' && decline ? linkToken(checkin.id, decline.response) : null,
  }
}

export const links = [
  // The scanner rule: a mail scanner's prefetch may apply «sigue perdida», never «ya apareció».
  route(api.openCheckinLink, ({ params }) => {
    const at = Date.now()
    const found = resolve(params.token, at)
    const state = stateOf(found, at)
    if (state !== 'open') return view(found, state)
    if (found.answer.kind === 'consequential') return view(found, 'confirm')
    apply(found)
    return view(found, 'applied')
  }),

  route(api.confirmCheckinLink, ({ params }) => {
    const at = Date.now()
    const found = resolve(params.token, at)
    const state = stateOf(found, at)
    if (state !== 'open') return view(found, state)
    apply(found)
    return view(found, 'applied')
  }),
]
