// The types of share.js, which scripts/build-share.mjs bundles from api/_share.ts at deploy time.
declare const share: { fetch(request: Request): Promise<Response> }
export default share
