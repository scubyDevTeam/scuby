-- GET /me/cases (MyCasesQueries.query): SELECT … FROM lost_case JOIN pet … WHERE created_by = ?
-- ORDER BY published_at DESC, code — every case the caller published, in any status.
-- Plan before (20,000 cases over 1,000 publishers; A2 report): Seq Scan on lost_case (cost 1139) + Sort, total 1289.
-- Plan after: Bitmap Index Scan on this index (about 19 rows) + a small Sort, Nested Loop on pet_pkey; total 222.
-- Write cost: one entry per case, for the life of the case (cases are low-volume writes).
-- Overlaps: lost_case_one_active_per_pet (pet_id), lost_case_active_published_idx (published_at,
-- active only) — neither leads with created_by. Not partial: «Mis casos» lists every status.
-- Needs human approval before merge.
CREATE INDEX lost_case_by_publisher_idx ON lost_case (created_by, published_at DESC);
