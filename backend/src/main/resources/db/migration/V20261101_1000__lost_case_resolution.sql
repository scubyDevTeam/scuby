-- How a lost case left `active`, and who helped (docs/product/04-lost-workflow.md · resolution values; L1 design
-- docs/superpowers/specs/2026-11-01-lost-vertical-l1-design.md §2.1). Written only by the cases feature.
-- L1 writes reunited_home (reunite), false_alarm and duplicate (cancel). The L2 migration that brings no_response
-- (expiry), and found_deceased / gave_up if the client takes that proposal (open item O35), replaces
-- lost_case_resolution_fits_status. resolution may be NULL on a closed row so rows written before this migration stay
-- valid; every L1 close sets it. resolved_at is when the case left `active`; the 30-day reopen window counts from it.
-- An active case carries no resolution data: reopen and claim reactivation clear all three columns.
ALTER TABLE lost_case
  ADD COLUMN resolution             text,
  ADD COLUMN resolution_attribution text CHECK (resolution_attribution IN
             ('platform_sighting', 'platform_claim', 'platform_share', 'offline', 'unknown')),
  ADD CONSTRAINT lost_case_resolution_fits_status CHECK (resolution IS NULL
       OR (status = 'reunited'  AND resolution = 'reunited_home')
       OR (status = 'cancelled' AND resolution IN ('false_alarm', 'duplicate'))),
  ADD CONSTRAINT lost_case_attribution_only_reunited CHECK (resolution_attribution IS NULL OR status = 'reunited'),
  ADD CONSTRAINT lost_case_active_is_unresolved CHECK (status <> 'active' OR (resolution IS NULL AND resolved_at IS NULL));
