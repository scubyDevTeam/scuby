package co.scuby.uploads;

import co.scuby.platform.media.ProfilePhotos;
import co.scuby.platform.security.Caller;
import org.springframework.stereotype.Component;

import java.util.List;

/** ProfilePhotos through PhotoAttachments with purpose `profile` (Propagation.NEVER is kept: PhotoAttachments is called as a bean). */
@Component
class ProfilePhotoCheck implements ProfilePhotos {

    private final PhotoAttachments attachments;

    ProfilePhotoCheck(PhotoAttachments attachments) {
        this.attachments = attachments;
    }

    @Override
    public void requireAttachable(String url, Caller caller, String field) {
        attachments.requireAttachable(List.of(url), UploadPurpose.profile, caller, field);
    }
}
