-- Fixtures for running the web client's e2e specs against a local backend (backend/e2e/run-client-e2e.sh).
-- Mirrors what web/e2e/lost-case.spec.ts opens from web/src/mocks/fixtures.ts (line numbers per row).
-- Times are relative to now() (operator data: allowed here). Runs only against the e2e compose project's
-- own database (scuby-e2e-<checkout>), which it wipes first.
TRUNCATE scuby.recovery_claim, scuby.sighting, scuby.lost_case, scuby.purged_case_code, scuby.responsibility_link, scuby.pet,
         scuby.upload, scuby.session, scuby.phone_otp, scuby.code_send, scuby.email_code, scuby.person CASCADE;

INSERT INTO scuby.person (id, display_name, display_name_chosen, email, created_at) VALUES
  ('00000000-0000-0000-0000-00000000ca01', 'Carolina Mejía', true, 'carolina@correo.co', now() - interval '240 days'),   -- fixtures.ts:498
  ('00000000-0000-0000-0000-00000000ca02', 'Julián Restrepo', true, 'julian@correo.co', now() - interval '400 days'),   -- fixtures.ts:500 (closedLost's created_by, :208)
  ('00000000-0000-0000-0000-00000000ca03', 'Andrés Rojas', true, 'andres@correo.co', now() - interval '95 days');       -- fixtures.ts:502

INSERT INTO scuby.pet (id, name, species, size, colors, marks, photo_urls, custody_state, created_at) VALUES
  -- fixtures.ts:514-523 (pet-luna)
  ('00000000-0000-0000-0000-00000000be01', 'Luna', 'dog', 'small', '{black,tan}',
   'Collar rojo con placa metálica. Mancha blanca en el pecho. Es tímida: no la persigas, llámala por su nombre y agáchate.',
   '{}', 'claimed', now() - interval '3 days'),
  -- fixtures.ts:558 (pet-toby, from the name list)
  ('00000000-0000-0000-0000-00000000be02', 'Toby', 'dog', 'medium', '{brown}', NULL, '{}', 'claimed', now() - interval '20 days'),
  -- Pelusa, a cat of Carolina's, for the reopen flows (@PLOST-002, @PLOST-004)
  ('00000000-0000-0000-0000-00000000be03', 'Pelusa', 'cat', 'small', '{white}', NULL, '{}', 'claimed', now() - interval '60 days'),
  -- fixtures.ts:532-545 (pet-milo, Julián's orange cat; @HELP-002 opens M2TQ4)
  ('00000000-0000-0000-0000-00000000be04', 'Milo', 'cat', 'small', '{orange}', NULL, '{}', 'claimed', now() - interval '5 days'),
  -- fixtures.ts:558-570 (pet-kira, from the name list; @HELP-005 opens ARCH2)
  ('00000000-0000-0000-0000-00000000be05', 'Kira', 'dog', 'small', '{brown}', NULL, '{}', 'claimed', now() - interval '30 days');

INSERT INTO scuby.responsibility_link (id, person_id, pet_id, role, active_from) VALUES
  (gen_random_uuid(), '00000000-0000-0000-0000-00000000ca01', '00000000-0000-0000-0000-00000000be01', 'owner', now() - interval '3 days'),
  (gen_random_uuid(), '00000000-0000-0000-0000-00000000ca02', '00000000-0000-0000-0000-00000000be02', 'owner', now() - interval '20 days'),
  (gen_random_uuid(), '00000000-0000-0000-0000-00000000ca01', '00000000-0000-0000-0000-00000000be03', 'owner', now() - interval '60 days'),
  (gen_random_uuid(), '00000000-0000-0000-0000-00000000ca02', '00000000-0000-0000-0000-00000000be04', 'owner', now() - interval '5 days'),
  (gen_random_uuid(), '00000000-0000-0000-0000-00000000ca02', '00000000-0000-0000-0000-00000000be05', 'owner', now() - interval '30 days');

INSERT INTO scuby.lost_case (code, pet_id, created_by, status, published_at, resolved_at, contact_phone, contact_phone_verified, phone_has_whatsapp,
  expose_whatsapp, expose_email, in_app_only, last_seen_lat, last_seen_lng, last_seen_public_lat, last_seen_public_lng, last_seen_radius_m,
  last_seen_at, place_name) VALUES
  -- fixtures.ts:229-243 (7K3PQ: Laureles, 100 m, published 2 days ago, +573000000000 with WhatsApp exposed)
  ('7K3PQ', '00000000-0000-0000-0000-00000000be01', '00000000-0000-0000-0000-00000000ca01', 'active', now() - interval '2 days', NULL,
   '+573000000000', true, true, true, false, false, 6.2447, -75.5916, 6.2442, -75.591256, 100, now() - interval '2 days', 'Laureles'),
  -- fixtures.ts:197-223 + :260 (closedLost H4PPY: reunited 3 days ago, published 10 days ago, offset(400, -300), 300 m)
  ('H4PPY', '00000000-0000-0000-0000-00000000be02', '00000000-0000-0000-0000-00000000ca02', 'reunited', now() - interval '10 days', now() - interval '3 days',
   '+573000000003', true, true, true, false, false, 6.24829, -75.59431, 6.2478, -75.593587, 300, now() - interval '10 days', 'Laureles'),
  -- Pelusa's case, expired 3 days ago (inside the 30-day reopen window), resolution NULL
  ('PEL4S', '00000000-0000-0000-0000-00000000be03', '00000000-0000-0000-0000-00000000ca01', 'expired', now() - interval '20 days', now() - interval '3 days',
   '+573000000000', true, true, true, false, false, 6.2447, -75.5916, 6.2442, -75.591256, 200, now() - interval '20 days', 'Laureles'),
  -- fixtures.ts:246-261 (M2TQ4, Milo: active, published 1 day ago, offset(-1500, -1400), 300 m, Belén). Its check-in is not
  -- seeded: there is no check-in table before L2.
  ('M2TQ4', '00000000-0000-0000-0000-00000000be04', '00000000-0000-0000-0000-00000000ca02', 'active', now() - interval '1 day', NULL,
   '+573000000003', true, true, true, false, false, 6.23123, -75.60425, 6.2316, -75.603925, 300, now() - interval '1 day', 'Belén'),
  -- fixtures.ts:197-223 + :262 (closedLost ARCH2, Kira: expired 5 days ago, published 12 days ago, offset(400, -300), 300 m).
  -- fixtures.ts says resolution no_response; L1 has no such value (it arrives with expiry in L2), so resolution stays NULL.
  ('ARCH2', '00000000-0000-0000-0000-00000000be05', '00000000-0000-0000-0000-00000000ca02', 'expired', now() - interval '12 days', now() - interval '5 days',
   '+573000000003', true, true, true, false, false, 6.24829, -75.59431, 6.2478, -75.593587, 300, now() - interval '12 days', 'Laureles');

INSERT INTO scuby.sighting (id, case_code, lat, lng, seen_at, created_at, note, reporter_person_id, reporter_device_hash,
  contact_phone, status) VALUES
  -- fixtures.ts:669-672 (s1: offset(-90, -80), 46 h ago)
  (gen_random_uuid(), '7K3PQ', 6.24389, -75.59232, now() - interval '46 hours', now() - interval '46 hours', 'Corría asustada por la 70',
   NULL, repeat('a', 64), NULL, 'visible'),
  -- fixtures.ts:674-677 (s2: offset(60, 240), 17 h ago)
  (gen_random_uuid(), '7K3PQ', 6.24524, -75.58943, now() - interval '17 hours', now() - interval '17 hours', NULL,
   NULL, repeat('b', 64), '+573156677889', 'visible'),
  -- fixtures.ts:679-685 (s3: offset(260, 310), 2 h ago, by Andrés; its mock photo is not seeded)
  (gen_random_uuid(), '7K3PQ', 6.24704, -75.58880, now() - interval '2 hours', now() - interval '2 hours', 'Iba hacia el parque, con collar rojo',
   '00000000-0000-0000-0000-00000000ca03', repeat('c', 64), '+573000000001', 'visible');

-- An open claim on Luna by Andrés Rojas (the claim @LINK-001's owner step finds)
INSERT INTO scuby.recovery_claim (id, case_code, claimant_person_id, phone, status, created_at, last_active_at) VALUES
  (gen_random_uuid(), '7K3PQ', '00000000-0000-0000-0000-00000000ca03', '+573114829017', 'open', now() - interval '3 hours',
   now() - interval '3 hours');

-- fixtures.ts:666
INSERT INTO scuby.purged_case_code (code, purged_at) VALUES ('GONE5', now() - interval '40 days');
