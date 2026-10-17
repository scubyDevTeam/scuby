// Small values that must outlive a reload on this device: today the sighting queue
// (docs/eng/frontend.md · Risks §6). Storage can be missing, blocked or full (private mode, a
// sandboxed frame, quota): every read and write degrades to "nothing kept", never to a thrown error.

function area(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

export function readStored<T>(key: string): T | null {
  try {
    const raw = area()?.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

/** `null` removes the key. */
export function writeStored(key: string, value: unknown): void {
  try {
    if (value === null) area()?.removeItem(key)
    else area()?.setItem(key, JSON.stringify(value))
  } catch {
    // Over quota or blocked: this session still works, it just won't survive a reload.
  }
}
