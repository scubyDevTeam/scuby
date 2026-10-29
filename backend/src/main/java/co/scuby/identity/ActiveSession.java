package co.scuby.identity;

import java.time.Instant;
import java.util.UUID;

record ActiveSession(UUID personId, Instant expiresAt) {}
