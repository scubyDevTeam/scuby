package co.scuby.platform.security;

import jakarta.servlet.http.HttpServletRequest;

import java.util.Optional;
import java.util.UUID;

/** Answers who is signed in on this request (identity supplies it: the session cookie). Must not write. */
@FunctionalInterface
public interface RequestAuthenticator {
    Optional<UUID> authenticate(HttpServletRequest request);
}
