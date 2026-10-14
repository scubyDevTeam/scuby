// The emulated backend's memory: fixtures at load, then whatever the app writes during the session.
import type { z } from 'zod'
import type { lostCaseWire } from '../contracts/case'
import { cases } from './fixtures'
import { mockPhoto } from './photo'

type LostCaseWire = z.input<typeof lostCaseWire>

/** The account «Continuar con Google» signs into: it owns Luna, so the owner's side can be tried. */
export const DEMO_OWNER_ID = 'user-carolina'

export type MockPet = {
  id: string
  owner_id: string
  name: string
  species: 'dog' | 'cat' | 'other'
  size: 'small' | 'medium' | 'large' | null
  colors: string[]
  marks: string | null
  photo_urls: string[]
}

const fresh = () => ({
  cases: cases(),
  /** case code → account that published it */
  owners: { '7K3PQ': DEMO_OWNER_ID } as Record<string, string>,
  /** case code → pet */
  casePets: { '7K3PQ': 'pet-luna' } as Record<string, string>,
  pets: [
    {
      id: 'pet-luna',
      owner_id: DEMO_OWNER_ID,
      name: 'Luna',
      species: 'dog',
      size: 'small',
      colors: ['Negro', 'Canela'],
      marks: 'Collar rojo con placa metálica. Mancha blanca en el pecho.',
      photo_urls: [mockPhoto('#3b2f2f')],
    },
  ] as MockPet[],
  /** Codes published during this session, newest first: they lead the feed. */
  published: [] as string[],
  nextId: 1,
})

// Kept for the life of the tab, so a reload does not wipe what was published — a real backend
// would not forget either. A new tab starts from the fixtures again.
const KEY = 'mock-db'

function load(): ReturnType<typeof fresh> {
  try {
    const stored = sessionStorage.getItem(KEY)
    if (stored) return JSON.parse(stored)
  } catch {
    // Unreadable or unavailable storage: start from the fixtures.
  }
  return fresh()
}

export const db = load()

export function persist() {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(db))
  } catch {
    // Over quota (photos are stored inline): the session still works, it just will not survive a reload.
  }
}

export const newId = (prefix: string) => `${prefix}${db.nextId++}`

export function lostCase(code: unknown): LostCaseWire | undefined {
  const found = db.cases[String(code).toUpperCase()]
  return found?.vertical === 'lost' ? found : undefined
}

// Short codes: 5 characters, no 0/O or 1/l/I (docs/product/10 §1).
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
export function newCode(): string {
  let code = ''
  for (let i = 0; i < 5; i++) code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)]
  return db.cases[code] ? newCode() : code
}
