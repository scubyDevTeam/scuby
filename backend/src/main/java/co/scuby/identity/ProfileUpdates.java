package co.scuby.identity;

import co.scuby.platform.media.ProfilePhotos;
import co.scuby.platform.security.Account;
import co.scuby.platform.security.Caller;
import co.scuby.platform.web.ApiException;
import co.scuby.platform.web.ErrorCode;
import co.scuby.platform.web.Patch;
import org.springframework.stereotype.Service;

import java.util.Map;

/**
 * PATCH /me/profile (docs/eng/auth.md · Profile; L1 design §4.12). The field rules (ProfileTextDerivation), then the photo:
 * the current photo_url is accepted as it is, another must be this caller's `profile` upload (checked with no transaction
 * open: S3 in staging), then one UPDATE … RETURNING. The answer is ProfileView.of, exactly as GET /me/profile. The name is
 * read live everywhere (no cache holds it: ActiveSession caches only the person id and expiry).
 */
@Service
class ProfileUpdates {

    private final People people;
    private final ProfilePhotos photos;

    ProfileUpdates(People people, ProfilePhotos photos) {
        this.people = people;
        this.photos = photos;
    }

    ProfileView update(Account account, Caller caller, ProfileUpdateRequest body) {
        Map<String, String> problems = ProfileTextDerivation.problems(body);
        if (!problems.isEmpty()) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "request does not match the contract", problems, Map.of());
        }
        String photo = body.photoUrl().value();
        if (photo != null && !photo.equals(people.get(account.personId()).photoUrl())) {
            photos.requireAttachable(photo, caller, "photo_url");
        }
        Patch<String> name = body.displayName().isPresent()
                ? Patch.of(ProfileTextDerivation.trimmedName(body.displayName().value()))
                : Patch.absent();
        return ProfileView.of(people.updateProfile(account.personId(), new People.ProfileChange(
                name, body.city(), body.bio(), body.notificationPrefs().value(), body.photoUrl())));
    }
}
