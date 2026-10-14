import { useSyncExternalStore } from 'react'

/** Matches the `lg` breakpoint of the design: phone layout below, desktop layout from here up. */
const DESKTOP = '(min-width: 1024px)'

function subscribe(onChange: () => void) {
  const query = window.matchMedia?.(DESKTOP)
  query?.addEventListener('change', onChange)
  return () => query?.removeEventListener('change', onChange)
}

/** For mounting something on one layout only (the map). Pure styling belongs in CSS breakpoints. */
export function useIsDesktop(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia?.(DESKTOP).matches ?? false,
    () => false,
  )
}
