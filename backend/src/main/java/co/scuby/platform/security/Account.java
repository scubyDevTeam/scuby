package co.scuby.platform.security;

import java.util.UUID;

/** A controller parameter that requires a signed-in person; resolving it without one answers `unauthorized`. */
public record Account(UUID personId) {}
