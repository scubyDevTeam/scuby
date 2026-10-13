// The product name is configuration (docs/product/00 · #21). No user-facing string spells it:
// UI copy, the page title, the manifest, the poster and the share tags read it from here.
import { env } from './env'

export const brand = {
  name: env.brandName,
  shortName: env.brandShortName,
  origin: env.publicOrigin,
} as const
