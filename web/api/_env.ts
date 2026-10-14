// The share function's configuration. It runs on the server, so it reads process.env — here and
// nowhere else (the app's own reader is src/env.ts). Keys and mock values: .env; on Vercel, the
// project's env vars reach functions as well as the build.

export type ShareEnv = {
  /** Where the public case comes from. Undefined (empty or `mock-…`) = no API: the plain shell. */
  apiUrl: string | undefined
  /** The short link's origin: og:url, and the base for a relative photo URL. */
  publicOrigin: string
  /** The product name is configuration (docs/product/00 · #21): og:site_name and `{brand}`. */
  brandName: string
}

const configured = (value: string | undefined) =>
  value && !value.startsWith('mock-') ? value : undefined

export function readEnv(source: Record<string, string | undefined> = process.env): ShareEnv {
  const publicOrigin = source.VITE_PUBLIC_ORIGIN
  const brandName = source.VITE_BRAND_NAME
  if (!publicOrigin || !brandName) {
    throw new Error('Missing VITE_PUBLIC_ORIGIN or VITE_BRAND_NAME — see web/.env')
  }
  return { apiUrl: configured(source.SHARE_API_URL), publicOrigin, brandName }
}
