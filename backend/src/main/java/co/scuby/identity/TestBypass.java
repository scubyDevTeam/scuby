package co.scuby.identity;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.util.List;
import java.util.Locale;

/**
 * Fixed codes for e2e runs (design · Test bypasses): addresses on these domains and numbers with these
 * prefixes accept `code`. Refused under prod by TestBypassGuard.
 */
@ConfigurationProperties("scuby.auth.test-bypass")
record TestBypass(List<String> emailDomains, List<String> smsPrefixes, String code) {

    TestBypass {
        emailDomains = emailDomains == null ? List.of() : emailDomains.stream().map(d -> d.toLowerCase(Locale.ROOT)).toList();
        smsPrefixes = smsPrefixes == null ? List.of() : List.copyOf(smsPrefixes);
        if (code == null || !code.matches("^\\d{6}$")) code = "123456";
    }

    boolean emailBypassed(String normalizedEmail) {
        return emailDomains.stream().anyMatch(d -> normalizedEmail.endsWith("@" + d));
    }

    boolean smsBypassed(String e164) {
        return smsPrefixes.stream().anyMatch(e164::startsWith);
    }

    boolean any() {
        return !emailDomains.isEmpty() || !smsPrefixes.isEmpty();
    }
}
