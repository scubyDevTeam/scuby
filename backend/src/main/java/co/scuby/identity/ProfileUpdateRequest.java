package co.scuby.identity;

import co.scuby.platform.web.Patch;
import com.fasterxml.jackson.annotation.JsonProperty;
import org.jspecify.annotations.Nullable;

/**
 * ProfileUpdateRequest (web/src/contracts/session.ts · updateProfile). PATCH semantics: absent = unchanged; city, bio and
 * photo_url may be sent as null to clear; null display_name or notification_prefs is validation_failed. The four
 * notification booleans come together (the contract requires them): an absent one is a Jackson error naming it.
 */
record ProfileUpdateRequest(Patch<String> displayName, Patch<String> city, Patch<String> bio,
                            Patch<NotificationPrefsInput> notificationPrefs, Patch<String> photoUrl) {

    record NotificationPrefsInput(@JsonProperty(required = true) @Nullable Boolean lost,
                                  @JsonProperty(required = true) @Nullable Boolean found,
                                  @JsonProperty(required = true) @Nullable Boolean adoption,
                                  @JsonProperty(required = true) @Nullable Boolean help) {}
}
