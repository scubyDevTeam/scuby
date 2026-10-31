package co.scuby.uploads;

import co.scuby.platform.modules.ModuleApi;
import co.scuby.platform.security.Caller;
import co.scuby.platform.web.ApiException;
import co.scuby.platform.web.ErrorCode;
import org.jooq.DSLContext;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

import static co.scuby.db.generated.Tables.UPLOAD;

/**
 * The publish-side check of docs/eng/api.md · Uploads: only this caller's processed photos, for this purpose.
 *
 * <p>Runs <b>outside</b> any transaction ({@code Propagation.NEVER} fails fast if a caller forgets):
 * in S3 mode each {@code isStored} is a HeadObject round-trip, which must not hold a pooled
 * connection or a transaction open (design · Identity, connection hygiene). Callers check photos
 * first, then open their transaction.
 *
 * <p>Known limitation (recorded in backend.md · Uploads): "uploaded by this caller" means "took a
 * slot for this hash". Every public photo URL contains its hash, so anyone can take a slot for a
 * photo they saw (the answer is {@code upload: null}) and attach it. Enforcing a fresh PUT is an
 * open question in the report.
 */
@ModuleApi
@Component
public class PhotoAttachments {

    static final String REASON = "photo not uploaded by this caller for this purpose, or not processed yet";

    private final DSLContext db;
    private final Clock clock;
    private final MediaStore store;
    private final MediaProperties properties;

    PhotoAttachments(DSLContext db, Clock clock, MediaStore store, MediaProperties properties) {
        this.db = db;
        this.clock = clock;
        this.store = store;
        this.properties = properties;
    }

    @Transactional(propagation = Propagation.NEVER)
    public void requireAttachable(List<String> photoUrls, UploadPurpose purpose, Caller caller, String field) {
        if (photoUrls.isEmpty()) return;
        List<String> hashes = new ArrayList<>();
        for (String url : photoUrls) {
            Optional<String> sha = store.sha256Of(url);
            if (sha.isEmpty()) throw refused(field);
            hashes.add(sha.get());
        }
        // The account's slots, and the device's (a slot taken before sign-in); both keys come from Caller.ownerKey().
        List<String> owners = List.of(caller.ownerKey(), new Caller(null, caller.deviceHash(), caller.ipHash()).ownerKey());
        Set<String> slotted = db.select(UPLOAD.SHA256).from(UPLOAD)
                                .where(UPLOAD.OWNER_KEY.in(owners))
                                .and(UPLOAD.SHA256.in(hashes))
                                .and(UPLOAD.PURPOSE.eq(purpose.name()))
                                .and(UPLOAD.CREATED_AT.gt(clock.instant().minus(properties.attachWindow()).atOffset(ZoneOffset.UTC)))
                                .fetchSet(UPLOAD.SHA256);
        for (String sha : hashes) {
            if (!slotted.contains(sha) || !store.isStored(sha)) throw refused(field);
        }
    }

    private static ApiException refused(String field) {
        return new ApiException(ErrorCode.VALIDATION_FAILED, REASON, Map.of(field, REASON), Map.of());
    }
}
