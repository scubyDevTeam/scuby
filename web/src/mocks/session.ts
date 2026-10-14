// The emulated session lives in localStorage so it survives a reload, like a real cookie would.
import { HttpResponse } from 'msw'

export type MockUser = { id: string; display_name: string; email: string; phone: string | null }

const KEY = 'mock-session'

export function currentUser(): MockUser | null {
  const stored = localStorage.getItem(KEY)
  return stored ? (JSON.parse(stored) as MockUser) : null
}

export function saveUser(user: MockUser | null) {
  if (user) localStorage.setItem(KEY, JSON.stringify(user))
  else localStorage.removeItem(KEY)
}

export const unauthorized = () => new HttpResponse(null, { status: 401 })
