package co.scuby.cases;

import org.jooq.DSLContext;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Component;

import java.security.SecureRandom;
import java.util.Locale;
import java.util.Optional;
import java.util.regex.Pattern;

import static co.scuby.db.generated.Tables.LOST_CASE;
import static co.scuby.db.generated.Tables.PURGED_CASE_CODE;

/** Case codes (docs/product/10-sharing.md): 5 characters, unambiguous alphabet, never reused. */
@Component
class CaseCodes {

    static final String ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
    private static final Pattern LOOKUP = Pattern.compile("^[A-Z0-9]{5}$");
    private static final SecureRandom RANDOM = new SecureRandom();

    private final DSLContext db;

    CaseCodes(DSLContext db) {
        this.db = db;
    }

    String newCode() {
        for (int attempt = 0; attempt < 10; attempt++) {
            StringBuilder code = new StringBuilder(5);
            for (int i = 0; i < 5; i++) code.append(ALPHABET.charAt(RANDOM.nextInt(ALPHABET.length())));
            String c = code.toString();
            boolean taken = db.fetchExists(DSL.selectOne().from(LOST_CASE).where(LOST_CASE.CODE.eq(c))
                    .unionAll(DSL.selectOne().from(PURGED_CASE_CODE).where(PURGED_CASE_CODE.CODE.eq(c))));
            if (!taken) return c;
        }
        throw new IllegalStateException("no free case code after 10 attempts");
    }

    /** Lookups are case-insensitive; anything that cannot be a code is simply unknown. */
    static Optional<String> normalize(String raw) {
        String upper = raw == null ? "" : raw.toUpperCase(Locale.ROOT);
        return LOOKUP.matcher(upper).matches() ? Optional.of(upper) : Optional.empty();
    }
}
