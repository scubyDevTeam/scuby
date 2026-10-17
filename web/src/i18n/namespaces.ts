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
  // The found page's words with its screen too; reporting a find and the witness page wait for
  // their own routes.
  'found',
  // A lost pet's forms — «La vi», «Lo tengo», the owner's endings, publishing, the check-in — wait
  // for the button that opens them: a stranger opening the link reads the page, not its forms.
  'lost_forms',
  // The edit form of found, adoption and help notices.
  'edit_case',
  // The «Mensajes» tab, a thread and the first message from a case: only with their screens.
  'chat',
  // The same for a help request: its page's words with its screen, offering help and the
  // beneficiary's side with those forms.
  'help',
  'help_forms',
  // What a tapped map pin shows: its words come with the sheet, after the tap.
  'map_sheet',
  // The pages behind the email's one-tap links (/r/<token>), and home's «pregunta pendiente»
  // banner, which only a signed-in person with a question waiting downloads.
  'links',
  'checkin_banner',
] as const

export type DeferredNamespace = (typeof DEFERRED_NAMESPACES)[number]
