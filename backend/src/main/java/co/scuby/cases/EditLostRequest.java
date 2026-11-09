package co.scuby.cases;

import co.scuby.platform.web.Patch;

import java.time.OffsetDateTime;
import java.util.List;

/**
 * EditLostRequest (web/src/contracts/owner.ts · editLost). Every field optional: absent = unchanged; marks may be sent
 * as null to clear it; null for any other field is validation_failed (LostEditDerivation.problems). Bound without @Valid:
 * the field rules run after the owner check (L1 design §3).
 */
record EditLostRequest(Patch<List<String>> photoUrls, Patch<String> marks, Patch<PointInput> lastSeenPoint,
                       Patch<Double> lastSeenRadiusM, Patch<OffsetDateTime> lastSeenAt) {}
