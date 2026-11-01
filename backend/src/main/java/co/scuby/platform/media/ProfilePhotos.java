package co.scuby.platform.media;

import co.scuby.platform.security.Caller;

/**
 * The profile-photo check identity needs without depending on uploads (foundations depend only on platform, as
 * RequestAuthenticator does for the session filter). uploads implements it: the photo must be this caller's processed
 * upload for purpose `profile`; else validation_failed on {@code field}. Never call it inside a transaction (S3 in staging).
 */
public interface ProfilePhotos {
    void requireAttachable(String url, Caller caller, String field);
}
