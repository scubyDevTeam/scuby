// The emulated session cookie: who is signed in, kept in localStorage so it survives a reload.
import { db, type PersonRow, persist, person } from './db'
import { read, write } from './storage'

const KEY = 'mock-session'
const DEVICE = 'mock-device'

type Stored = Pick<PersonRow, 'id' | 'display_name' | 'email'>

export function currentUser(): PersonRow | null {
  const stored = read<Stored>('local', KEY)
  if (!stored) return null
  // A new tab starts from the fixtures; an account created in another tab is born again here.
  const found = person(stored.id)
  if (found) return found
  const reborn: PersonRow = {
    ...stored,
    phone: null,
    city: null,
    bio: null,
    notification_prefs: { lost: true, found: true, adoption: true, help: true },
    joined_at: new Date().toISOString(),
  }
  db.persons.push(reborn)
  persist()
  return reborn
}

export function signIn(user: PersonRow) {
  write('local', KEY, { id: user.id, display_name: user.display_name, email: user.email })
}

export const signOut = () => write('local', KEY, null)

/** The emulated `device` cookie (api.md · Device identity): who someone is without an account. */
export function deviceKey(): string {
  const stored = read<string>('local', DEVICE)
  if (stored) return stored
  const key = `device-${Math.random().toString(36).slice(2, 10)}`
  write('local', DEVICE, key)
  return key
}
