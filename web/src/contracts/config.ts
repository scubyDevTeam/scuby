// hand-written until O14 — provisional wire shape.
import { z } from 'zod'

const countryWire = z.object({
  code: z.string(),
  phone_prefix: z.string(),
  mobile_pattern: z.string(),
  /** Where a map opens when the device gives no location. */
  default_center: z.object({ lat: z.number(), lng: z.number() }),
})

export const configWire = z.object({ supported_countries: z.array(countryWire).min(1) })

export type Country = {
  code: string
  phonePrefix: string
  mobilePattern: string
  defaultCenter: { lat: number; lng: number }
}
export type Config = { countries: [Country, ...Country[]] }

export function parseConfig(raw: unknown): Config {
  const [first, ...rest] = configWire.parse(raw).supported_countries.map((c) => ({
    code: c.code,
    phonePrefix: c.phone_prefix,
    mobilePattern: c.mobile_pattern,
    defaultCenter: c.default_center,
  }))
  if (!first) throw new Error('No supported country')
  return { countries: [first, ...rest] }
}
