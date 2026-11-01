package co.scuby.identity;

import co.scuby.identity.ProfileUpdateRequest.NotificationPrefsInput;
import org.jspecify.annotations.Nullable;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * PATCH /me/profile field rules (docs/eng/auth.md · Profile; L1 design §4.12). Pure. The bio has no links: a WhatsApp link
 * in a bio would bypass the case's contact preferences. Refused, case-insensitive, explicit link forms only: http://,
 * https://, www., wa.me, tel:, mailto:, and a token ending in a known TLD (.com .co .net .org .io .me .ly .link .app .info
 * .biz .xyz .site .online .store .shop). Accepted on purpose: «Av.Poblado», «EE.UU.», «caminar.Vivo», «p.ej.». Accepted
 * misses: a link on a TLD outside the list (decision 12: Spanish prose must not be refused).
 */
final class ProfileTextDerivation {

    static final int NAME_MAX = 80;
    static final int BIO_MAX = 280;
    static final int CITY_MAX = 80;

    private static final Pattern LINK = Pattern.compile(
            "(?iu)(https?://|\\bwww\\.|\\bwa\\.me|\\btel:|\\bmailto:"
                    + "|[\\p{L}\\p{N}_-]+\\.(?:com|co|net|org|io|me|ly|link|app|info|biz|xyz|site|online|store|shop)(?![\\p{L}\\p{N}]))");

    private ProfileTextDerivation() {}

    static boolean hasLink(String text) {
        return LINK.matcher(text).find();
    }

    static String trimmedName(String raw) {
        return raw.strip();
    }

    static Map<String, String> problems(ProfileUpdateRequest body) {
        Map<String, String> found = new LinkedHashMap<>();
        if (body.displayName().isPresent()) {
            String raw = body.displayName().value();
            if (raw == null) found.put("display_name", "required");
            else if (trimmedName(raw).isEmpty()) found.put("display_name", "must not be empty");
            else if (length(trimmedName(raw)) > NAME_MAX) found.put("display_name", "at most 80 characters");
        }
        String city = body.city().value();
        if (city != null && length(city) > CITY_MAX) found.put("city", "at most 80 characters");
        String bio = body.bio().value();
        if (bio != null) {
            if (length(bio) > BIO_MAX) found.put("bio", "at most 280 characters");
            else if (hasLink(bio)) found.put("bio", "no links");
        }
        if (body.notificationPrefs().isPresent()) {
            NotificationPrefsInput prefs = body.notificationPrefs().value();
            if (prefs == null) {
                found.put("notification_prefs", "required");
            } else {
                requireFlag(found, "lost", prefs.lost());
                requireFlag(found, "found", prefs.found());
                requireFlag(found, "adoption", prefs.adoption());
                requireFlag(found, "help", prefs.help());
            }
        }
        String photo = body.photoUrl().value();
        if (photo != null && photo.isBlank()) found.put("photo_url", "must not be empty");
        return found;
    }

    private static void requireFlag(Map<String, String> found, String name, @Nullable Boolean value) {
        if (value == null) found.put("notification_prefs." + name, "required");
    }

    private static int length(String s) {
        return s.codePointCount(0, s.length());
    }
}
