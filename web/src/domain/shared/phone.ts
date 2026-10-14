// Phone rules come from a `supported_countries` row (docs/eng/auth.md) — never from code.
export type PhoneRules = {
  /** «+57» */
  prefix: string
  /** Regex source for the national mobile number, digits only: «^3\d{9}$». */
  mobilePattern: string
}

/** The number as stored (E.164), or null when it is not a mobile number of that country. */
export function toE164(input: string, rules: PhoneRules): string | null {
  const digits = input.replace(/\D/g, '')
  return new RegExp(rules.mobilePattern).test(digits) ? `${rules.prefix}${digits}` : null
}
