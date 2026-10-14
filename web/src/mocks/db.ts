// The emulated backend's memory: fixtures at load, then whatever the app writes during the session.
import { cases } from './fixtures'

export const db = { cases: cases(), nextId: 1 }

export const newId = (prefix: string) => `${prefix}${db.nextId++}`
