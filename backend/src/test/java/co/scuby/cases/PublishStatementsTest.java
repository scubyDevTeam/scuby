package co.scuby.cases;

import co.scuby.platform.crypto.Hashing;
import co.scuby.platform.flags.FeatureFlags;
import co.scuby.support.Accounts;
import co.scuby.support.ApiClient;
import co.scuby.support.ApiClients;
import co.scuby.support.ApiResponse;
import co.scuby.support.IntegrationTest;
import co.scuby.support.PublishBodies;
import co.scuby.support.RecordingSmsSender;
import co.scuby.support.TestDb;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import co.scuby.platform.cache.ClearableCache;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpMethod;

import java.util.LinkedHashMap;
import java.util.Map;

import static co.scuby.db.generated.Tables.LOST_CASE;
import static org.assertj.core.api.Assertions.assertThat;

/** Measured SQL statements per publish path (the ceiling in StatementCeilings is the highest of these). */
@IntegrationTest
class PublishStatementsTest {

    static final String PHONE = "+573007152284";
    static final String AT = "2026-10-14T08:00:00-05:00";

    @Autowired ApiClients clients;
    @Autowired TestDb testDb;
    @Autowired Accounts accounts;
    @Autowired RecordingSmsSender sms;
    @Autowired DSLContext db;
    @Autowired ObjectProvider<ClearableCache> caches;

    /** Every call starts from empty caches (session lookup, flag snapshot): the honest worst case, as StatementCeilings counts it. */
    private ApiResponse publishCold(ApiClient client, String body) {
        // The session-lookup cache only. Not the dev media store (it holds the uploaded bytes the photo check looks
        // for) and not the flag snapshot (process-wide, reloaded once per 30 s: +2 statements on one request in 30 s,
        // not a per-request cost, so it is left out of the ceilings as everywhere else).
        caches.orderedStream()
              .filter(c -> !c.getClass().getSimpleName().contains("MediaStore") && !(c instanceof FeatureFlags))
              .forEach(ClearableCache::clear);
        return client.post("/lost-cases", body);
    }

    @BeforeEach
    void setUp() { testDb.reset(); }

    @Test
    void everyPublishPathStaysWithinItsMeasuredCount() {
        Map<String, Integer> counts = new LinkedHashMap<>();
        ApiClient api = clients.newBrowser();
        accounts.signIn(api, "ana.gomez@correo.co");

        byte[] bytes = "kira-photo".getBytes();
        String sha = Hashing.sha256Hex(bytes);
        String url = api.post("/uploads", """
                {"purpose":"pet","sha256":"%s","content_type":"image/jpeg","bytes":%d}""".formatted(sha, bytes.length)).str("/url");
        api.rawBytes(HttpMethod.PUT, "/dev-media/{sha}.jpg", bytes, "image/jpeg", sha);
        String withPhoto = "[\"" + url + "\"]";

        ApiResponse r = publishCold(api, PublishBodies.kira(PHONE, null, withPhoto, AT, 300));
        counts.put("otp (code sent, photos)", r.statements().size());
        String wrong = sms.lastCodeFor(PHONE).equals("000000") ? "111111" : "000000";
        r = publishCold(api, PublishBodies.kira(PHONE, wrong, withPhoto, AT, 300));
        counts.put("wrong code", r.statements().size());
        r = publishCold(api, PublishBodies.kira(PHONE, null, withPhoto, AT, 300));
        counts.put("otp repeat (cooldown)", r.statements().size());
        r = publishCold(api, PublishBodies.kira(PHONE, sms.lastCodeFor(PHONE), withPhoto, AT, 300));
        counts.put("correct code (new pet, photos)", r.statements().size());
        r = publishCold(api, PublishBodies.kira(null, null));
        counts.put("verified number", r.statements().size());
        String petId = db.select(LOST_CASE.PET_ID).from(LOST_CASE).limit(1).fetchOne().value1().toString();
        r = publishCold(api, PublishBodies.withPetId(petId, null));
        counts.put("pet_id, active case exists (409)", r.statements().size());

        db.update(LOST_CASE).set(LOST_CASE.STATUS, "expired").execute();
        r = publishCold(api, PublishBodies.withPetId(petId, null));
        counts.put("pet_id, republish after the case closed", r.statements().size());

        db.update(LOST_CASE).set(LOST_CASE.STATUS, "expired").execute();
        r = publishCold(api, PublishBodies.withPetId(petId, "+573001234567"));
        counts.put("pet_id, a new number (code sent)", r.statements().size());
        ApiResponse worst = r;
        String code = sms.lastCodeFor("+573001234567");
        r = publishCold(api, PublishBodies.withPetId(petId, "+573001234567").replace("\"otp_code\":null", "\"otp_code\":\"" + code + "\""));
        counts.put("pet_id, a new number, correct code", r.statements().size());

        ApiClient flagOff = clients.newBrowser();
        var bea = accounts.signIn(flagOff, "bea@correo.co");
        db.execute("INSERT INTO scuby.feature_flag_overrides (flag_key, person_id, enabled, reason) VALUES ('publisher_phone_otp', ?, false, 'test')", bea);
        r = publishCold(flagOff, PublishBodies.kira(PHONE, null));
        counts.put("flag off", r.statements().size());

        System.out.println("STMTS " + counts);
        System.out.println("STMTS-SQL " + worst.statements());
        // Pinned (not just recorded): the highest path is the ceiling in StatementCeilings, with a session-cache miss.
        assertThat(counts).containsEntry("pet_id, a new number (code sent)", 14);
        assertThat(counts.values()).allSatisfy(n -> assertThat(n).isBetween(1, 14));
    }
}
