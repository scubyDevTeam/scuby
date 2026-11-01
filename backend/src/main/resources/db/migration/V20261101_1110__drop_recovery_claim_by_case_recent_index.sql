-- Drops recovery_claim_by_case_recent_idx (case_code, created_at DESC); adds none (decision 18). The owner's claim list is now
-- ordered by last_active_at DESC, id DESC, which that index cannot serve. A replacement on (case_code, last_active_at DESC, id DESC)
-- would not be used either: the query counts the open non-stale claims of the whole case with count(*) FILTER (...) OVER (), so the
-- plan must read every claim of the case before it sorts and limits (WindowAgg, then Sort, then Limit); an index's order never
-- survives the WindowAgg. What the plan needs is the case_code prefix to bound the read to one case, and
-- recovery_claim_one_per_claimant (case_code, claimant_person_id) already gives it: RecoveryClaimPlanTest (a heavy case of 2,000
-- claims among 62,000) and ClaimCountPlanTest show it chosen, no sequential scan. So the table keeps one fewer index to maintain:
-- the write cost of a claim insert drops by one btree entry. Needs human approval before merge.
DROP INDEX recovery_claim_by_case_recent_idx;
