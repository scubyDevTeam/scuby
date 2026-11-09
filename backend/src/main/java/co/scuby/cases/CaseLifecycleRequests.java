package co.scuby.cases;

import com.fasterxml.jackson.annotation.JsonProperty;
import org.jspecify.annotations.Nullable;

/**
 * ReuniteRequest and CancelRequest (web/src/contracts/owner.ts). Bound as strings, not enums: a value outside the list
 * is a body error checked after the owner check (spec §3), not a Jackson error before the lookups. Absent is a Jackson error.
 */
final class CaseLifecycleRequests {

    private CaseLifecycleRequests() {}

    record ReuniteRequest(@JsonProperty(required = true) @Nullable String resolutionAttribution) {}

    record CancelRequest(@JsonProperty(required = true) @Nullable String resolution) {}
}
