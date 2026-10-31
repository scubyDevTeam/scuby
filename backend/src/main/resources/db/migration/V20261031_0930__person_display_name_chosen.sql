-- Whether the person chose their display name (or Google supplied their own name) rather than the placeholder derived from
-- their email's local part (DisplayNames.fromEmail, kept for the person's own screens: the contract's display_name is required).
-- A derived name is never public: a case's contact shows the generic «Alguien» / «Someone» until the person names themselves,
-- so an address like jperez1987@gmail.com never reaches a shared case card (review I3).
-- The default is the safe side: an unmarked name is treated as derived.
ALTER TABLE person ADD COLUMN display_name_chosen boolean NOT NULL DEFAULT false;
