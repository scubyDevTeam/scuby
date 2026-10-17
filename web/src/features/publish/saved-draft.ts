// A publish form that survives a reload, a closed tab or a phone call (frontend-plan · lost-flow
// leftovers): what was typed is kept on this device, per form and per account, for a week. Never
// sent anywhere, and dropped once the notice is published or the person starts over.
import { readStored, writeStored } from '@platform/storage'
import { useEffect, useRef, useState } from 'react'

const WEEK = 7 * 24 * 3_600_000

type Stored<T> = { v: 1; savedAt: number; value: T }

export const draftKey = (form: string, userId: string) => `draft.${form}.${userId}`

/** What was kept for this form, unless it is older than a week or from another shape. */
export function readDraft<T>(key: string, now = Date.now()): T | null {
  const stored = readStored<Stored<T>>(key)
  if (stored?.v !== 1 || typeof stored.savedAt !== 'number') return null
  return now - stored.savedAt > WEEK ? null : stored.value
}

/**
 * State kept on the device as it changes. `restored` says the form opened on something kept, so
 * the screen can say so and offer to start over.
 */
export function useSavedDraft<T>(key: string, initial: T) {
  const [kept] = useState(() => readDraft<T>(key))
  const [value, setValue] = useState<T>(kept ?? initial)
  const [restored, setRestored] = useState(kept !== null)
  const live = useRef(true)

  useEffect(() => {
    if (!live.current) return
    writeStored(key, { v: 1, savedAt: Date.now(), value } satisfies Stored<T>)
  }, [key, value])

  return {
    value,
    setValue,
    restored,
    /** Back to an empty form, and nothing kept. */
    discard: () => {
      writeStored(key, null)
      setRestored(false)
      setValue(initial)
    },
    /** Published: nothing to keep any more, and nothing is written again. */
    clear: () => {
      live.current = false
      writeStored(key, null)
    },
  }
}
