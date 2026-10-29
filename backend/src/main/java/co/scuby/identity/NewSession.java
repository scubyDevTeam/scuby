package co.scuby.identity;

import java.time.Instant;

/** A session just created: the raw token (only for the cookie; never stored) and its absolute expiry. */
record NewSession(String token, Instant expiresAt) {}
