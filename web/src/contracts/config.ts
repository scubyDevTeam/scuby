// hand-written until O14 — provisional wire shape.
import { z } from 'zod'

const countryWire = z.object({
  code: z.string(),
  phone_prefix: z.string(),
  mobile_pattern: z.string(),
})

export const configWire = z.object({ supported_countries: z.array(countryWire).min(1) })

export type Country = { code: string; phonePrefix: string; mobilePattern: string }
export type Config = { countries: [Country, ...Country[]] }

export function parseConfig(raw: unknown): Config {
  const [first, ...rest] = configWire.parse(raw).supported_countries.map((c) => ({
    code: c.code,
    phonePrefix: c.phone_prefix,
    mobilePattern: c.mobile_pattern,
  }))
  if (!first) throw new Error('No supported country')
  return { countries: [first, ...rest] }
}
