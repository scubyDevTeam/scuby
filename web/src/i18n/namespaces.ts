// Which top-level namespaces of a language file wait for the screen that uses them. Everything
// else — what a case page, the feed and the app chrome need — ships with the first paint. A new
// namespace is first-paint until it is listed here (docs/eng/frontend.md · Languages, Budgets).
// Plain data: vite.config.ts reads it to split the files at build time.
export const DEFERRED_NAMESPACES = [
  'publish',
  'auth',
  'mine',
  'reporting',
  'legal',
  'push',
  'sharing',
] as const

export type DeferredNamespace = (typeof DEFERRED_NAMESPACES)[number]
