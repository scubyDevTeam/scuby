package co.scuby.identity;

import org.jspecify.annotations.Nullable;

import java.util.Locale;
import java.util.Set;

/** `hostedDomain` is the token's `hd` claim (Google Workspace domain), null for consumer accounts. */
record GoogleIdentity(String sub, String email, @Nullable String name, @Nullable String hostedDomain) {

    private static final Set<String> GOOGLE_MAIL_DOMAINS = Set.of("gmail.com", "googlemail.com");

    /**
     * Google is the authority over this mailbox: a Google-run mail domain, or a Workspace whose `hd`
     * equals the address's domain. Any other verified address only proves some provider said so.
     */
    boolean emailAuthoritative() {
        String address = email.strip().toLowerCase(Locale.ROOT);
        String domain = address.substring(address.lastIndexOf('@') + 1);
        return GOOGLE_MAIL_DOMAINS.contains(domain)
                || (hostedDomain != null && domain.equals(hostedDomain.strip().toLowerCase(Locale.ROOT)));
    }
}
