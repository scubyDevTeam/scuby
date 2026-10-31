package co.scuby.cases;

import org.jspecify.annotations.Nullable;

import java.util.UUID;

/** Who is looking, as the derivation needs it: the access, and who they are for `mine`. */
record Viewer(Access access, @Nullable UUID personId, String deviceHash) {}
