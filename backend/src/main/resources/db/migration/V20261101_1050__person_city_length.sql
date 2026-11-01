-- person.city is free text of at most 80 characters until a cities table exists (docs/eng/auth.md · Profile; open item
-- O34; L1 design §2.5). PATCH /me/profile is the first writer of city, so no existing row can violate it. The request
-- check mirrors it with @CodePoints semantics (Postgres length() counts characters, not UTF-16 units).
ALTER TABLE person ADD CONSTRAINT person_city_length CHECK (length(city) <= 80);
