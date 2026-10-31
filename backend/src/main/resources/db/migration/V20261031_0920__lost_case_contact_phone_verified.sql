-- Whether the case's contact number was verified by SMS code when it was published (PublisherPhone.Ready.verified).
-- With the publisher_phone_otp flag off (O24) the number is stored unverified; an unverified number is never public:
-- LostCaseQueries.WHATSAPP_PHONE requires this column besides active / exposed / on WhatsApp.
-- Cases that predate the column (development databases only: nothing is deployed) are treated as unverified, so they lose
-- their public wa.me link until republished: the safe side.
ALTER TABLE lost_case ADD COLUMN contact_phone_verified boolean NOT NULL DEFAULT false;
ALTER TABLE lost_case ALTER COLUMN contact_phone_verified DROP DEFAULT;
