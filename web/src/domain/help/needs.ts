// docs/product/07 · `help_need`: what one request asks for, and how far it got.

/** The v1 set (D10 defers the rest): a home for a while, a ride, things. */
export const NEED_KINDS = ['foster', 'transport', 'supplies'] as const
export type NeedKind = (typeof NEED_KINDS)[number]

/** One request carries 1–3 needs. */
export const MAX_NEEDS = 3

export type NeedStatus = 'open' | 'covered' | 'closed'

export type NeedProgress = {
  /** What arrived, as the beneficiary confirmed it. */
  confirmed: number
  /** What people offered and has not been confirmed yet. */
  pledged: number
  /** Null = «lo que puedan»: no number to reach. */
  target: number | null
}

type Pledge = { status: 'pledged' | 'confirmed' | 'declined' | 'withdrawn'; quantity: number }

/**
 * Progress shows both, never one self-reported number: confirmed first, pledged second
 * (07 · `help_pledge`). Declined and withdrawn pledges count for nothing.
 */
export function progress(target: number | null, pledges: readonly Pledge[]): NeedProgress {
  const sum = (status: Pledge['status']) =>
    pledges.filter((p) => p.status === status).reduce((total, p) => total + p.quantity, 0)
  return { confirmed: sum('confirmed'), pledged: sum('pledged'), target }
}

/**
 * Covered when confirmations reach the target — pledges alone never cover anything: a promise is
 * not a ride (07 · Rule: only the beneficiary closes a need). Without a target, only the
 * beneficiary's word covers it.
 */
export function reachedTarget(p: NeedProgress): boolean {
  return p.target !== null && p.confirmed >= p.target
}

/** Can someone still offer? Only on an open need that confirmations have not filled. */
export const acceptsPledges = (status: NeedStatus, p: NeedProgress) =>
  status === 'open' && !reachedTarget(p)

/** «hogar» for foster, «viaje» for transport; supplies are counted in what `detail` names. */
export const defaultTarget: Record<NeedKind, number | null> = {
  foster: 1,
  transport: 1,
  supplies: null,
}
