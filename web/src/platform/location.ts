export type Position = { lat: number; lng: number }

/**
 * The position only when the person already allowed it: never shows the permission prompt. For a
 * screen that works without it (the feed), so a first visit from a shared link is not met by a prompt.
 */
export async function getGrantedPosition(): Promise<Position | null> {
  try {
    const status = await navigator.permissions?.query({ name: 'geolocation' })
    if (status?.state !== 'granted') return null
  } catch {
    return null
  }
  return getCurrentPosition()
}

/** Optional everywhere (frontend.md · Rule 4): null when denied, unavailable or too slow. */
export function getCurrentPosition(): Promise<Position | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null)
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ lat: position.coords.latitude, lng: position.coords.longitude }),
      () => resolve(null),
      { timeout: 8000, maximumAge: 60_000 },
    )
  })
}
