// The emulated backend's state: the tables (tables.ts), seeded from fixtures.ts and kept per tab.
import { seed } from './fixtures'
import { read, write } from './storage'
import type { Tables } from './tables'

export type * from './tables'

// Kept for the life of the tab, so a reload does not wipe what was published — a real backend
// would not forget either. A new tab starts from the fixtures again.
const KEY = 'mock-db'
const VERSION = 3

function load(): Tables {
  const stored = read<{ version: number; tables: Tables }>('session', KEY)
  return stored?.version === VERSION ? stored.tables : seed()
}

export const db: Tables = load()

export function persist() {
  write('session', KEY, { version: VERSION, tables: db })
}

export const snapshot = () => JSON.stringify(db)
export function restore(saved: string) {
  Object.assign(db, JSON.parse(saved) as Tables)
}

/** Back to the fixtures: for tests, and for anyone who wants a clean demo. */
export function resetDb() {
  Object.assign(db, seed())
  persist()
}

export const newId = (prefix: string) => `${prefix}${db.nextId++}`

// Short codes: 5 characters, no 0/O or 1/l/I (docs/product/10 §1).
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
export function newCode(): string {
  let code = ''
  for (let i = 0; i < 5; i++) code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)]
  return db.cases[code] || db.purged.includes(code) ? newCode() : code
}

export const findCase = (code: string) => db.cases[code.toUpperCase()]
export const person = (id: string | null) => db.persons.find((p) => p.id === id) ?? null
export const pet = (id: string) => db.pets.find((p) => p.id === id) ?? null
