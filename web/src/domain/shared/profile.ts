// docs/eng/auth.md · Profile: the bio is ~280 characters of plain text with no links — a bio with
// a WhatsApp link bypasses the contact prefs. Shape checks for instant feedback; the server decides.
export const BIO_MAX_LENGTH = 280

// A scheme, «www.», a WhatsApp or Telegram short link, or a bare domain with a path or a common TLD.
const LINK =
  /\b(?:[a-z][a-z0-9+.-]*:\/\/|www\.|wa\.me\b|t\.me\b|[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|co|net|org|me|ly|io|app|link|gl|to|info|site)\b)/i

export function hasLink(text: string): boolean {
  return LINK.test(text)
}

export type ProfileDraft = { displayName: string; bio: string }

export type ProfileError = 'name_required' | 'bio_has_link' | 'bio_too_long'

export function profileErrors(draft: ProfileDraft): ProfileError[] {
  const errors: ProfileError[] = []
  if (draft.displayName.trim() === '') errors.push('name_required')
  if (hasLink(draft.bio)) errors.push('bio_has_link')
  if (draft.bio.trim().length > BIO_MAX_LENGTH) errors.push('bio_too_long')
  return errors
}
