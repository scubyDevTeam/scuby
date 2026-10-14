// One question the person responsible for a case owes an answer to (docs/product/04 · The
// follow-up loop; 06 reuses it for adoption listings).
import * as z from 'zod/mini'
import { timestamp } from './primitives'

export const checkinWire = z.object({
  id: z.string(),
  trigger: z.enum(['time_based', 'post_recovery_claim']),
  /** Set on a claim check-in: the claim the three answers are about. */
  claim_id: z.nullable(z.string()),
  asked_at: timestamp,
})
