// Every e2e test carries two tags: the flow it belongs to and a key of its own.
//   pnpm e2e --grep @publish-lost      one flow
//   pnpm e2e --grep @LOST-002          one test
// Keys are FLOW-NNN, never reused once deleted, so a key in a ticket or a CI log always means one
// test. scripts/check-e2e-tags.mjs fails the build when a test lacks either tag or a key repeats.

/** Flow tag → the prefix its keys use. */
export const FLOWS = {
  '@feed': 'FEED',
  '@case-link': 'LINK',
  '@helper': 'HELP',
  '@auth': 'AUTH',
  '@publish-lost': 'PLOST',
  '@owner': 'OWNER',
  '@found': 'FOUND',
  '@publish-found': 'PFOUND',
  '@i18n': 'I18N',
  '@inbox': 'INBOX',
  '@profile': 'PROFILE',
} as const

export type Flow = keyof typeof FLOWS

/** `{ tag: ['@feed', '@FEED-001'] }` — the details argument of `test()`. */
export const tags = <F extends Flow>(flow: F, key: `@${(typeof FLOWS)[F]}-${number}`) => ({
  tag: [flow, key],
})
