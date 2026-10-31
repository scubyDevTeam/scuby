package co.scuby.uploads;

import co.scuby.platform.modules.ModuleApi;

/** What a photo is for (web/src/contracts/actions.ts). Constants are the wire values. */
@ModuleApi
public enum UploadPurpose {
    pet, sighting, claim, evidence, profile;

    /** Publishing a pet and editing a profile already need an account. */
    boolean needsSession() {
        return this == pet || this == profile;
    }
}
