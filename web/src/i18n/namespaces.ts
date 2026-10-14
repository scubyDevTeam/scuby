// Which top-level namespaces of a language file wait for the screen that uses them. Everything
// else — what a case page, the feed and the app chrome need — ships with the first paint. A new
// namespace is first-paint until it is listed here (docs/eng/frontend.md · Languages, Budgets).
// Plain data: vite.config.ts reads it to split the files at build time. `preview` is the link
// preview's words (api/share.ts): only the server reads them, so the app never downloads them.
export const DEFERRED_NAMESPACES = [
  'publish',
  'auth',
  'mine',
  'reporting',
  'legal',
  'push',
  'sharing',
  'preview',
  // The adoption page's words arrive with its screen (c.$code.tsx), as its chunk does: a link to a
  // lost pet must not download them. Saying «Me interesa», the lister's side of a listing and
  // publishing one wait for those forms.
  'adoption',
  'adoption_forms',
] as const

export type DeferredNamespace = (typeof DEFERRED_NAMESPACES)[number]
