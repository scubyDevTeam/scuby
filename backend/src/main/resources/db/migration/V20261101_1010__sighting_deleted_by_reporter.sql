-- A reporter deletes their own pin inside its 15-minute window as a status, never a hard delete
-- (docs/product/04-lost-workflow.md · sighting; L1 design §2.2). The row stays, so its (case_code, client_id) replay key
-- stays taken (a replayed «Lo vi» answers the deleted row's id), sightings_count stays a count of visible rows, and a
-- claim's from_sighting_id never dangles. deleted_by_reporter is invisible to everyone, the owner included.
-- sighting_by_case_recent_idx is unchanged (status is INCLUDEd and filtered inside the index entry).
ALTER TABLE sighting DROP CONSTRAINT sighting_status_check,
  ADD CONSTRAINT sighting_status_check
      CHECK (status IN ('visible', 'hidden_by_owner', 'removed_by_moderation', 'deleted_by_reporter'));
