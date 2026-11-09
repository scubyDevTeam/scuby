-- Decision 15: one claim per person per case, whatever its status. The owner's answer no longer frees the slot: the
-- claimant's next «Lo tengo» gets that same claim back. So the open-only unique index becomes a plain unique one, and the
-- claim upsert is INSERT … ON CONFLICT (case_code, claimant_person_id) DO UPDATE … WHERE status = 'open'. Against an answered
-- claim the DO UPDATE writes nothing, and that holds even when the owner answers between the caller's read and the upsert
-- (a partial index would let the upsert insert a second row once the answer commits). Write cost: one entry per claim
-- (before: one per open claim); the index is never rewritten by an answer, because status is not an indexed column.
-- Overlap: recovery_claim_by_case_recent_idx (V20261101_1030) shares the case_code prefix but is not unique and orders by
-- created_at. No dedupe step: no environment holds a person with two claims on a case yet (L1 is unmerged; the old
-- index allowed it only after an answer). Needs human approval before merge.
DROP INDEX recovery_claim_one_open_per_claimant;
CREATE UNIQUE INDEX recovery_claim_one_per_claimant ON recovery_claim (case_code, claimant_person_id);
