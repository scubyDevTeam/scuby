// Where the emulated backend keeps its state: web storage in the browser, memory in unit tests.
const memory = new Map<string, string>()

function area(kind: 'local' | 'session'): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  try {
    const store = kind === 'local' ? globalThis.localStorage : globalThis.sessionStorage
    if (store) return store
  } catch {
    // Storage blocked (private mode, sandboxed frame): fall through to memory.
  }
  return {
    getItem: (key) => memory.get(`${kind}:${key}`) ?? null,
    setItem: (key, value) => void memory.set(`${kind}:${key}`, value),
    removeItem: (key) => void memory.delete(`${kind}:${key}`),
  }
}

export function read<T>(kind: 'local' | 'session', key: string): T | null {
  try {
    const raw = area(kind).getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

export function write(kind: 'local' | 'session', key: string, value: unknown) {
  try {
    if (value === null) area(kind).removeItem(key)
    else area(kind).setItem(key, JSON.stringify(value))
  } catch {
    // Over quota (photos are stored inline): this session still works, it just won't survive a reload.
  }
}
