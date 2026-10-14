// Every failure the API answers with, as a closed set. The body is always the same envelope, so a
// screen can tell «the code is wrong» from «the phone is missing» without reading prose.
import * as z from 'zod/mini'

/** Error code → HTTP status. One table for the client, the emulated backend and the spec. */
export const ERROR_STATUS = {
  /** The body or query does not match the contract; `fields` names what is wrong. */
  validation_failed: 422,
  /** No session, and the endpoint needs one. */
  unauthorized: 401,
  /** Signed in, but this is someone else's case, claim or notification. */
  forbidden: 403,
  not_found: 404,
  /** It existed and was purged: a printed poster's code still resolves to «ya no está disponible». */
  gone: 410,
  /** The action does not apply to the case's current status (closing a closed case). */
  invalid_transition: 409,
  /** The pet already has an active lost case; `details.case_code` is the one to open. */
  active_case_exists: 409,
  /** Wrong or expired 6-digit code, emailed or by SMS. */
  invalid_code: 422,
  /** Publishing needs a number and the account has none verified. */
  phone_required: 422,
  /** A sighting more than 30 km from where the animal was last seen. */
  sighting_too_far: 422,
  seen_at_in_future: 422,
  /** A sighting dated more than 24 h before the animal went missing. */
  seen_at_before_case: 422,
  rate_limited: 429,
  server_error: 500,
} as const

export type ErrorCode = keyof typeof ERROR_STATUS

export const ERROR_CODES = Object.keys(ERROR_STATUS) as [ErrorCode, ...ErrorCode[]]

export const errorWire = z.object({
  error: z.object({
    code: z.enum(ERROR_CODES),
    /** For logs and developers. Never shown to people: the client writes its own copy per code. */
    message: z.string(),
    /** `validation_failed` only: wire field path → what is wrong with it. */
    fields: z.optional(z.record(z.string(), z.string())),
    /** Per-code extras, e.g. `{ case_code }` on `active_case_exists`. */
    details: z.optional(z.record(z.string(), z.string())),
  }),
})

export type ApiFailure = {
  code: ErrorCode
  fields: Record<string, string>
  details: Record<string, string>
}

/** The envelope, or null when the answer carries none (a proxy's 502, an old server). */
export function parseFailure(raw: unknown): ApiFailure | null {
  const parsed = errorWire.safeParse(raw)
  if (!parsed.success) return null
  const { code, fields, details } = parsed.data.error
  return { code, fields: fields ?? {}, details: details ?? {} }
}
