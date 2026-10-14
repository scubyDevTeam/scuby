// docs/eng/auth.md · Sign-in: email + 6-digit code. Shape checks for instant feedback only.
export const CODE_LENGTH = 6
export const RESEND_COOLDOWN_S = 60

export function isEmail(input: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.trim())
}

/** Digits only, capped at the code length — what the code field holds as the user types or pastes. */
export function cleanCode(input: string): string {
  return input.replace(/\D/g, '').slice(0, CODE_LENGTH)
}

export const isCompleteCode = (code: string) => code.length === CODE_LENGTH

/** «AB» for the avatar when there is no photo. */
export function initials(displayName: string): string {
  const words = displayName.trim().split(/\s+/).filter(Boolean)
  const letters = words.length > 1 ? [words[0], words.at(-1)] : [words[0]]
  return letters.map((word) => word?.[0]?.toUpperCase() ?? '').join('')
}
