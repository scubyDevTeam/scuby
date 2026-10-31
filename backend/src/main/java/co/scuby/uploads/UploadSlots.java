package co.scuby.uploads;

import co.scuby.platform.security.Caller;
import co.scuby.platform.web.ApiException;
import co.scuby.platform.web.ErrorCode;
import org.jooq.DSLContext;
import org.springframework.stereotype.Service;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Map;

import static co.scuby.db.generated.Tables.UPLOAD;

@Service
class UploadSlots {

    private final DSLContext db;
    private final Clock clock;
    private final MediaStore store;
    private final MediaProperties properties;

    UploadSlots(DSLContext db, Clock clock, MediaStore store, MediaProperties properties) {
        this.db = db;
        this.clock = clock;
        this.store = store;
        this.properties = properties;
    }

    /**
     * Not transactional on purpose: the upsert is a single autocommit statement, and {@code isStored} may be an
     * S3 HeadObject, which must never run while a connection is held (design · Identity, connection hygiene).
     * There is no cap on slots: abuse by IP belongs at the edge, and UploadPurge deletes rows older than the
     * attach window.
     */
    public UploadView slot(UploadRequest request, Caller caller) {
        if (request.purpose().needsSession() && !caller.signedIn()) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "this purpose needs a session",
                    Map.of("purpose", "needs a signed-in session"), Map.of());
        }
        Instant now = clock.instant();

        db.insertInto(UPLOAD)
          .set(UPLOAD.OWNER_KEY, caller.ownerKey())
          .set(UPLOAD.SHA256, request.sha256())
          .set(UPLOAD.PURPOSE, request.purpose().name())
          .set(UPLOAD.BYTES, request.bytes().intValue())
          .set(UPLOAD.CREATED_AT, now.atOffset(ZoneOffset.UTC))
          .onConflict(UPLOAD.OWNER_KEY, UPLOAD.SHA256, UPLOAD.PURPOSE).doUpdate()
          .set(UPLOAD.CREATED_AT, now.atOffset(ZoneOffset.UTC))
          .set(UPLOAD.BYTES, request.bytes().intValue())
          .execute();

        String url = store.publicUrl(request.sha256());
        UploadTarget target = store.isStored(request.sha256())
                ? null
                : store.presign(request.sha256(), request.bytes(), now.plus(properties.slotTtl()));
        return new UploadView(url, target);
    }
}
