export type Position = { lat: number; lng: number }

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
