// The Vercel function behind `/c/:code` and `/en/c/:code` (vercel.json). The code is api/_share.ts;
// this entry loads it bundled (scripts/build-share.mjs), because Vercel compiles each file on its
// own and Node cannot resolve the extensionless imports of the src/ modules it reuses.
export { default } from './_bundle/share.js'
