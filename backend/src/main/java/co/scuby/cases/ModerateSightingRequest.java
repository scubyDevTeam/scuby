package co.scuby.cases;

import co.scuby.platform.web.Patch;

/** ModerateSightingRequest (web/src/contracts/owner.ts · moderateSighting). Both optional; null for either is validation_failed. */
record ModerateSightingRequest(Patch<Boolean> highlighted, Patch<Boolean> hidden) {}
