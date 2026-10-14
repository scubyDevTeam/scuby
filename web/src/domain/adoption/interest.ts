// docs/product/06 · `adoption_interest` — the intro before the channel, and which channel opens.

export type Housing = 'house' | 'apartment'

export type IntroDraft = {
  housing: Housing | null
  hasYard: boolean | null
  otherPets: string
  household: string
  why: string
}

export const emptyIntro: IntroDraft = {
  housing: null,
  hasYard: null,
  otherPets: '',
  household: '',
  why: '',
}

export type IntroError = 'housing_required' | 'yard_required' | 'why_required'

/** Four fields and «¿por qué este?»: housing, yard and why must be answered; the rest may be blank. */
export function introErrors(draft: IntroDraft): IntroError[] {
  const errors: IntroError[] = []
  if (!draft.housing) errors.push('housing_required')
  if (draft.hasYard === null) errors.push('yard_required')
  if (!draft.why.trim()) errors.push('why_required')
  return errors
}

/**
 * Channel, after the row (06): one channel → straight there, no extra tap; WhatsApp and the
 * lister's own site → one sheet with both; neither → the in-app thread.
 */
export type Channel = 'whatsapp' | 'external' | 'choose' | 'in_app'

export function channelAfterInterest(channels: {
  whatsappUrl: string | null
  externalUrl: string | null
}): Channel {
  if (channels.whatsappUrl && channels.externalUrl) return 'choose'
  if (channels.whatsappUrl) return 'whatsapp'
  if (channels.externalUrl) return 'external'
  return 'in_app'
}

/** `wa.me` with the intro prefilled: the adopter does not have to retype what they just wrote. */
export function whatsappWithText(url: string, text: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}text=${encodeURIComponent(text)}`
}
