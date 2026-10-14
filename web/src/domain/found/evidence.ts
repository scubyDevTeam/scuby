// docs/product/05 · The evidence ladder: what an «Es mío» claim brings, ranked by how hard it is to
// fake. The platform never adjudicates — it labels, and the custodian decides.

export type EvidenceTier =
  | 'prior_lost_case' // system-verified: a lost case published before this found case
  | 'described' // free text to compare against the withheld detail
  | 'documented' // chip number, vet records, photos with the claimant
  | 'none' // a cold claim

export type ClaimEvidence = {
  /** Set when the claimant has a lost case for a matching animal, published before the found case. */
  fromLostCaseCode: string | null
  notes: string | null
  chipNumber: string | null
  photoCount: number
}

/** The strongest evidence a claim carries, in the doc's order. */
export function evidenceTier(evidence: ClaimEvidence): EvidenceTier {
  if (evidence.fromLostCaseCode) return 'prior_lost_case'
  if (evidence.notes?.trim()) return 'described'
  if (evidence.chipNumber?.trim() || evidence.photoCount > 0) return 'documented'
  return 'none'
}
