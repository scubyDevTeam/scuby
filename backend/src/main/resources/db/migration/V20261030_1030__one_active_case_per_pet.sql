-- Serves PublishLostService.activeCaseQuery: SELECT code FROM lost_case WHERE pet_id = ? AND status = 'active'
-- (the active_case_exists check), and enforces 04's invariant "a pet has at most one active lost case"
-- against concurrent publishes (the INSERT is ON CONFLICT DO NOTHING).
-- Plan before (20,000 cases, 10 % active): Seq Scan on lost_case (A2 report). After: Index Scan on this index.
-- Write cost: one entry per active case; leaves the index when the case closes. Overlaps: none.
-- Needs human approval before merge.
CREATE UNIQUE INDEX lost_case_one_active_per_pet ON lost_case (pet_id) WHERE status = 'active';
