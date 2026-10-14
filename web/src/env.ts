// The only module that reads import.meta.env. Keys and mock values: .env

const raw = import.meta.env

function required(key: string): string {
  const value = raw[key]
  if (typeof value !== 'string' || value === '') {
    throw new Error(`Missing env var ${key} — see web/.env`)
  }
  return value
}

// Empty or `mock-…` means "not configured": the caller gets undefined and keeps the feature off.
function optional(key: string): string | undefined {
  const value = raw[key]
  if (typeof value !== 'string' || value === '' || value.startsWith('mock-')) {
    return undefined
  }
  return value
}

/**
 * A constant the build can fold: in a production build (false) the emulated backend — and the copy of
 * the whole contract it carries — is dropped, and never shares a chunk with the first load.
 */
export const API_MOCK = import.meta.env.VITE_API_MOCK === 'true'

export const env = {
  brandName: required('VITE_BRAND_NAME'),
  brandShortName: required('VITE_BRAND_SHORT_NAME'),
  publicOrigin: required('VITE_PUBLIC_ORIGIN'),
  apiUrl: required('VITE_API_URL'),
  apiMock: API_MOCK,
  googleClientId: optional('VITE_GOOGLE_CLIENT_ID'),
  mapStyleUrl: optional('VITE_MAP_STYLE_URL'),
  vapidPublicKey: optional('VITE_VAPID_PUBLIC_KEY'),
  sentryDsn: optional('VITE_SENTRY_DSN'),
  // Set by the build (vite.config.ts · define), not by .env: the commit and the Vercel environment.
  buildId: String(raw.VITE_BUILD_ID ?? 'local'),
  deployEnv: String(raw.VITE_DEPLOY_ENV ?? raw.MODE),
  legalEmail: optional('VITE_LEGAL_EMAIL'),
} as const
